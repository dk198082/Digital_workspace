import { Router, type IRouter } from "express";
import * as oidcClient from "openid-client";
import { and, eq } from "drizzle-orm";
import {
  db,
  appUsersTable,
  usersTable,
  roleAssignmentsTable,
  rolesTable,
  appsTable,
} from "@workspace/db";
import { getOidcConfig, getRedirectUri } from "../lib/oidc";
import { logAudit } from "../lib/audit";
import {
  createEmbeddedSsoToken,
} from "../lib/embedded-sso";

const router: IRouter = Router();

const FRONTEND_URL = process.env["FRONTEND_URL"];
const ADMIN_CONSOLE_FRONTEND_URL =
  process.env["ADMIN_CONSOLE_FRONTEND_URL"];

  if (!FRONTEND_URL) {
  throw new Error("FRONTEND_URL is not configured");
}

if (!ADMIN_CONSOLE_FRONTEND_URL) {
  throw new Error("ADMIN_CONSOLE_FRONTEND_URL is not configured");
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

router.get("/auth/login", async (req, res, next) => {
  try {
    const config = await getOidcConfig();

    const app =
      req.query.app === "admin-console"
        ? "admin-console"
        : "workspace";

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



router.get("/auth/callback", async (req, res, next) => {

  const authApp = req.session.authApp;

  const targetFrontend =
    authApp === "admin-console"
      ? ADMIN_CONSOLE_FRONTEND_URL
      : FRONTEND_URL;

  try {

    const config = await getOidcConfig();
    const {
    codeVerifier,
    oauthState,
    } = req.session;

    if (!codeVerifier || !oauthState) {
      // res.redirect("/?auth_error=session_expired");
      res.redirect(`${targetFrontend}?auth_error=session_expired`);
      return;
    }

    const currentUrl = new URL(
      `${getRedirectUri(req).split("/api/")[0]}${req.originalUrl}`,
    );
    const tokens = await oidcClient.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedState: oauthState,
    });

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

    // Gate login: user must have an active entitlement for the "Admin Console"
    // app in the managed users / role-assignments system.
    const [entitled] = await db
      .select({ userId: usersTable.id })
      .from(usersTable)
      .innerJoin(roleAssignmentsTable, eq(roleAssignmentsTable.userId, usersTable.id))
      .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
      .innerJoin(appsTable, eq(rolesTable.appId, appsTable.id))
      .where(
        and(
          eq(usersTable.entraObjectId, entraObjectId),
          eq(usersTable.status, "active"),
          eq(rolesTable.isEntitlement, true),
          eq(appsTable.name, "Admin Console"),
        ),
      )
      .limit(1);

    if (!entitled) {
      req.log.warn(
        { entraObjectId, email, name },
        "Authenticated user denied: no Admin Console entitlement",
      );
      await logAudit(
        "ACCESS_DENIED",
        entraObjectId,
        `${name} (${email}) denied Admin Console login — no entitlement assigned`,
        name,
      );
      res.redirect(`${targetFrontend}?auth_error=not_authorized`);
      // res.redirect("/?auth_error=not_authorized");
      return;
    }

    const [appUser] = await db
      .insert(appUsersTable)
      .values({ entraObjectId, email, name })
      .onConflictDoUpdate({
        target: appUsersTable.entraObjectId,
        set: { email, name, lastLoginAt: new Date() },
      })
      .returning();

    // Regenerate the session ID on login to prevent session fixation.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.user = {
      id: appUser.id,
      entraObjectId: appUser.entraObjectId,
      email: appUser.email,
      name: appUser.name,
    };

    
    await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      }); });
      
    await logAudit("login", "Session", `${name} (${email}) signed in via Entra ID`, name);
    res.redirect(targetFrontend);
    
  } catch (err) {
    req.log.error({ err }, "Entra ID callback failed");
    // res.redirect("/?auth_error=callback_failed");
    res.redirect(`${targetFrontend}?auth_error=callback_failed`);
  }
});

router.get("/auth/me", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json(req.session.user);
});

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
      }
    > = {
      packing: {
        audience: "packing-control-board",
        callbackUrl:
          process.env.PACKING_CONTROL_FRONTEND_URL?.trim() || "",
      },

      productionPriority: {
        audience: "production-priority-board",
        callbackUrl:
          process.env.PRODUCTION_PRIORITY_FRONTEND_URL?.trim() || "",
      },

      productionShopFloor: {
        audience: "production-shop-floor",
        callbackUrl:
          process.env.PRODUCTION_SHOP_FLOOR_FRONTEND_URL?.trim() ||
          "",
      },

      fieldService: {
        audience: "field-service-calendar",
        callbackUrl:
          process.env.FIELD_SERVICE_FRONTEND_URL?.trim() ||
          "",
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
      "/api/auth/embedded-sso",
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


router.post("/auth/logout", async (req, res) => {
  const name = req.session.user?.name;
  if (name) {
    try {
      await logAudit("logout", "Session", `${name} signed out`, name);
    } catch (err) {
      req.log.error({ err }, "Failed to write logout audit entry");
    }
  }
  req.session.destroy(() => {
    res.json({ ok: true, loggedOutUser: name ?? null });
  });
});

router.get("/auth/logout", (req, res) => {
  req.session.destroy(() => {
     res.redirect(ADMIN_CONSOLE_FRONTEND_URL);
  });
});

export default router;
