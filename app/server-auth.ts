import { cookies } from "next/headers";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const AUTH_COOKIE_NAME = "operations-meeting-id-token";

const microsoftKeys = createRemoteJWKSet(
  new URL("https://login.microsoftonline.com/common/discovery/v2.0/keys"),
);

function requiredClientId() {
  const clientId = process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  if (!clientId) throw new Error("NEXT_PUBLIC_MSAL_CLIENT_ID が設定されていません。");
  return clientId;
}

function allowedEmails() {
  const configured =
    process.env.ALLOWED_AUTH_EMAILS ||
    process.env.NEXT_PUBLIC_ALLOWED_AUTH_EMAILS ||
    "";
  return configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function tokenEmail(payload: JWTPayload) {
  const claims = payload as JWTPayload & {
    preferred_username?: string;
    email?: string;
    upn?: string;
  };
  return (claims.preferred_username || claims.email || claims.upn || "")
    .trim()
    .toLowerCase();
}

export async function verifyMicrosoftIdToken(token: string) {
  const { payload } = await jwtVerify(token, microsoftKeys, {
    audience: requiredClientId(),
  });

  const tenantId = typeof payload.tid === "string" ? payload.tid : "";
  const expectedTenant = process.env.NEXT_PUBLIC_MSAL_TENANT_ID || "common";
  if (!tenantId || (expectedTenant !== "common" && tenantId !== expectedTenant)) {
    throw new Error("Microsoftテナントを確認できませんでした。");
  }

  const expectedIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  if (payload.iss !== expectedIssuer) {
    throw new Error("Microsoft IDトークンの発行元が一致しません。");
  }

  const email = tokenEmail(payload);
  const allowed = allowedEmails();
  if (!email || (!allowed.includes("*") && !allowed.includes(email))) {
    throw new Error("このアカウントには操作権限がありません。");
  }

  return { email, expiresAt: payload.exp };
}

export async function requireAuthorizedUser() {
  if (process.env.NODE_ENV !== "production") return { email: "local-development" };
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!token) throw new Error("認証セッションがありません。再ログインしてください。");
  return verifyMicrosoftIdToken(token);
}
