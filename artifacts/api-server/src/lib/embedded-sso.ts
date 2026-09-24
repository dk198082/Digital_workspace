import crypto from "node:crypto";
export type EmbeddedSsoPayload = {
  iss: "workspace";
  aud: string;
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
  nonce: string;
};

const TOKEN_TTL_SECONDS = 60;

function getSecret(): string {
  const secret = process.env.EMBEDDED_SSO_SECRET?.trim();

  if (!secret) {
    throw new Error("EMBEDDED_SSO_SECRET is not configured");
  }

  return secret;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(
    value.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function sign(value: string): string {
  return base64UrlEncode(
    crypto
      .createHmac("sha256", getSecret())
      .update(value)
      .digest(),
  );
}

export function createEmbeddedSsoToken(params: {
  audience: string;
  entraObjectId: string;
  email: string;
  name: string;
}): string {
  const now = Math.floor(Date.now() / 1000);

  const payload: EmbeddedSsoPayload = {
    iss: "workspace",
    aud: params.audience,
    sub: params.entraObjectId,
    email: params.email,
    name: params.name,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    nonce: crypto.randomBytes(16).toString("hex"),
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyEmbeddedSsoToken(
  token: string,
  expectedAudience: string,
): EmbeddedSsoPayload | null {
  try {
    const parts = token.split(".");

    if (parts.length !== 2) {
      return null;
    }

    const [encodedPayload, suppliedSignature] = parts;

    const expectedSignature = sign(encodedPayload);

    const suppliedBuffer = Buffer.from(suppliedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (suppliedBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (
      !crypto.timingSafeEqual(
        suppliedBuffer,
        expectedBuffer,
      )
    ) {
      return null;
    }

    const payload = JSON.parse(
      base64UrlDecode(encodedPayload),
    ) as EmbeddedSsoPayload;

    if (payload.iss !== "workspace") {
      return null;
    }

    if (payload.aud !== expectedAudience) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    if (payload.exp <= now) {
      return null;
    }

    if (!payload.sub) {
      return null;
    }

    if (!payload.email) {
      return null;
    }

    if (!payload.name) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}