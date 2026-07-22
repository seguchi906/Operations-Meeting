"use client";

import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "./msalInstance";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}
