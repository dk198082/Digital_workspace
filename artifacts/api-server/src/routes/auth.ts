import { Router, type IRouter } from "express";
import * as oidcClient from "openid-client";
import {
  db,
  appUsersTable,
} from "@workspace/db";
import { getOidcConfig, getRedirectUri } from "../lib/oidc";
import { logAudit } from "../lib/audit";
import { createEmbeddedSsoToken } from "../lib/embedded-sso";

const router: IRouter = Router();

const FRONTEND_URL = process.env["FRONTEND_URL"];
const ADMIN_CONSOLE_FRONTEND_URL =
  process.env["ADMIN_CONSOLE_FRONTEND_URL"];

if (!FRONTEND_URL) {
  throw new Error("FRONTEND_URL is not configured");
}

declare module "express-session" {
  interface SessionData {
    codeVerifier?: string;
    oauthState?: string;
    authApp?: "workspace" | "admin-console";
    user?: {
      id: number;
      entraObjectId: string;
      email: string;
      name: string;
    };
  }
}

// -----------------------------------------------------------------------------
// Microsoft Entra ID login
// -----------------------------------------------------------------------------

router.get("/auth/login", async (req, res, next) => {
  try {
    const app =
      req.query.app === "admin-console"
        ? "admin-console"
        : "workspace";

    if (app === "admin-console" && !ADMIN_CONSOLE_FRONTEND_URL) {
      res
        .status(500)
        .send("Admin Console frontend URL is not configured.");
      return;
    }

    const config = await getOidcConfig();

    req.session.authApp = app;

    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const codeChallenge =
      await oidcClient.calculatePKCECodeChallenge(codeVerifier);
    const state = oidcClient.randomState();

    req.session.codeVerifier = codeVerifier;
    req.session.oauthState = state;

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const url = oidcClient.buildAuthorizationUrl(config, {
      redirect_uri: getRedirectUri(req),
      scope: "openid profile email",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    });

    res.redirect(url.href);
  } catch (err) {
    next(err);
  }
});

// -----------------------------------------------------------------------------
// Microsoft Entra ID callback
//
// Workspace login requires a valid Entra ID sign-in, not an Admin Console
// entitlement. Individual applications must continue enforcing their own
// authorization requirements.
// -----------------------------------------------------------------------------

router.get("/auth/callback", async (req, res, next) => {
  const authApp = req.session.authApp;

  const targetFrontend =
    authApp === "admin-console"
      ? ADMIN_CONSOLE_FRONTEND_URL
      : FRONTEND_URL;

  if (!targetFrontend) {
    res.status(500).send("Frontend URL is not configured.");
    return;
  }

  try {
    const config = await getOidcConfig();
    const { codeVerifier, oauthState } = req.session;

    if (!codeVerifier || !oauthState) {
      res.redirect(
        `${targetFrontend}?auth_error=session_expired`,
      );
      return;
    }

    const currentUrl = new URL(
      `${getRedirectUri(req).split("/api/")[0]}${req.originalUrl}`,
    );

    const tokens = await oidcClient.authorizationCodeGrant(
      config,
      currentUrl,
      {
        pkceCodeVerifier: codeVerifier,
        expectedState: oauthState,
      },
    );

    // These values are no longer needed after the callback parameters
    // have been validated and exchanged.
    delete req.session.codeVerifier;
    delete req.session.oauthState;

    const claims = tokens.claims();

    if (!claims?.sub) {
      res.redirect(`${targetFrontend}?auth_error=no_claims`);
      return;
    }

    const entraObjectId = String(claims.oid ?? claims.sub);
    const email = String(
      claims.email ?? claims.preferred_username ?? "unknown",
    );
    const name = String(claims.name ?? email);

    // Create or update the local Workspace user.
    // No Admin Console entitlement is required for Workspace login.
    const [appUser] = await db
      .insert(appUsersTable)
      .values({ entraObjectId, email, name })
      .onConflictDoUpdate({
        target: appUsersTable.entraObjectId,
        set: {
          email,
          name,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    if (!appUser) {
      throw new Error("Unable to create or retrieve the Workspace user.");
    }

    // Regenerate the session ID to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    req.session.user = {
      id: appUser.id,
      entraObjectId: appUser.entraObjectId,
      email: appUser.email,
      name: appUser.name,
    };

    // Persist the authenticated session before redirecting.
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    await logAudit(
      "login",
      "Session",
      `${name} (${email}) signed in via Entra ID`,
      name,
    );

    res.redirect(targetFrontend);
  } catch (err) {
    req.log.error({ err }, "Entra ID callback failed");

    if (res.headersSent) {
      return;
    }

    res.redirect(`${targetFrontend}?auth_error=callback_failed`);
  }
});

// -----------------------------------------------------------------------------
// Current authenticated user
// -----------------------------------------------------------------------------

router.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json(req.session.user);
});

// -----------------------------------------------------------------------------
// Embedded SSO handoff
// -----------------------------------------------------------------------------

router.get("/auth/embedded-handoff", async (req, res, next) => {
  try {
    const user = req.session.user;

    if (!user) {
      res.status(401).send("Workspace authentication required.");
      return;
    }

    const target = String(req.query.target ?? "").trim();
    const returnTo = String(req.query.returnTo ?? "/").trim();

    const targetConfigs: Record<
      string,
      {
        audience: string;
        callbackUrl: string;
        ssoPath: string;
      }
    > = {
      packing: {
        audience: "packing-control-board",
        callbackUrl:
          process.env.PACKING_CONTROL_FRONTEND_URL?.trim() || "",
        ssoPath: "/api/auth/embedded-sso",
      },

      productionPriority: {
        audience: "production-priority-board",
        callbackUrl:
          process.env.PRODUCTION_PRIORITY_FRONTEND_URL?.trim() || "",
        ssoPath: "/api/auth/embedded-sso",
      },

      productionShopFloor: {
        audience: "production-shop-floor",
        callbackUrl:
          process.env.PRODUCTION_SHOP_FLOOR_FRONTEND_URL?.trim() || "",
        ssoPath: "/api/auth/embedded-sso",
      },

      fieldService: {
        audience: "field-service-calendar",
        callbackUrl:
          process.env.FIELD_SERVICE_FRONTEND_URL?.trim() || "",
        ssoPath: "/api/auth/embedded-sso",
      },

      proForma: {
        audience: "pro-forma-service-invoice",
        callbackUrl:
          process.env.PROFORMA_SERVICE_FRONTEND_URL?.trim() || "",
        ssoPath: "/api/auth/embedded-sso-proforma",
      },

      adminConsole: {
        audience: "admin-console",
        callbackUrl:
          process.env.ADMIN_CONSOLE_FRONTEND_URL?.trim() || "",
        ssoPath: "/api/auth/embedded-sso",
      },
    };

    const config = targetConfigs[target];

    if (!config || !config.callbackUrl) {
      res.status(400).send("Invalid embedded application.");
      return;
    }

    const token = createEmbeddedSsoToken({
      audience: config.audience,
      entraObjectId: user.entraObjectId,
      email: user.email,
      name: user.name,
    });

    const callbackUrl = new URL(
      config.ssoPath,
      config.callbackUrl,
    );

    callbackUrl.searchParams.set("token", token);
    callbackUrl.searchParams.set(
      "returnTo",
      returnTo.startsWith("/") ? returnTo : "/",
    );

    res.redirect(callbackUrl.toString());
  } catch (error) {
    next(error);
  }
});

// -----------------------------------------------------------------------------
// POST logout
// -----------------------------------------------------------------------------

router.post("/auth/logout", async (req, res) => {
  const name = req.session.user?.name;

  if (name) {
    try {
      await logAudit(
        "logout",
        "Session",
        `${name} signed out`,
        name,
      );
    } catch (err) {
      req.log.error({ err }, "Failed to write logout audit entry");
    }
  }

  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Failed to destroy session");
      res.status(500).json({ error: "Unable to sign out." });
      return;
    }

    res.json({ ok: true, loggedOutUser: name ?? null });
  });
});

// -----------------------------------------------------------------------------
// GET logout
// -----------------------------------------------------------------------------

router.get("/auth/logout", (req, res) => {
  const targetFrontend =
    req.session.authApp === "admin-console"
      ? ADMIN_CONSOLE_FRONTEND_URL
      : FRONTEND_URL;

  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Failed to destroy session");
      res.status(500).send("Unable to sign out.");
      return;
    }

    res.redirect(targetFrontend || FRONTEND_URL!);
  });
});

export default router;