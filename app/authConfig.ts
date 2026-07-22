import type { Configuration, RedirectRequest, SilentRequest } from "@azure/msal-browser";

const clientId =
  process.env.NEXT_PUBLIC_MSAL_CLIENT_ID ||
  (import.meta as any).env?.VITE_MSAL_CLIENT_ID ||
  "";

const tenantId =
  process.env.NEXT_PUBLIC_MSAL_TENANT_ID ||
  (import.meta as any).env?.VITE_MSAL_TENANT_ID ||
  "common";

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri: typeof window !== "undefined" ? window.location.origin : "/",
    postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : "/",
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

export const loginRequest: RedirectRequest = {
  scopes: ["User.Read"],
};

export const ssoSilentRequest: SilentRequest = {
  scopes: ["User.Read"],
  redirectUri:
    typeof window !== "undefined"
      ? `${window.location.origin}/redirect.html`
      : undefined,
};
