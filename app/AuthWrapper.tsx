"use client";

import React, { useEffect, useState, useRef } from "react";
import { useMsal } from "@azure/msal-react";
import type { AccountInfo } from "@azure/msal-browser";
import { loginRequest, ssoSilentRequest } from "./authConfig";

type AuthState =
  | { status: "loading"; message?: string }
  | { status: "authenticated"; email: string; name?: string }
  | { status: "unauthenticated" }
  | { status: "forbidden"; candidates: string[]; allowedConfig: string }
  | { status: "error"; message: string };

function getAllowedEmailsConfig(): string {
  const envVal =
    process.env.NEXT_PUBLIC_ALLOWED_AUTH_EMAILS ||
    (typeof window !== "undefined" && (window as any).env?.VITE_ALLOWED_AUTH_EMAILS) ||
    (import.meta as any).env?.VITE_ALLOWED_AUTH_EMAILS ||
    "";
  return envVal.trim();
}

function parseAllowedEmails(configStr: string): string[] {
  if (!configStr) return [];
  return configStr
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function getAccountEmailCandidates(account: AccountInfo): string[] {
  const claims = account.idTokenClaims as Record<string, any> | undefined;
  const rawList = [
    account.username,
    claims?.preferred_username,
    claims?.email,
    claims?.upn,
    claims?.login_hint,
  ];
  const validList = rawList
    .filter((e): e is string => typeof e === "string" && Boolean(e.trim()))
    .map((e) => e.trim().toLowerCase());
  return Array.from(new Set(validList));
}

function isEmailAllowed(emailCandidate: string, allowedEmails: string[]): boolean {
  if (allowedEmails.includes("*")) return true;
  return allowedEmails.includes(emailCandidate.toLowerCase());
}

export function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { instance } = useMsal();
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const allowedConfig = getAllowedEmailsConfig();

    if (!allowedConfig) {
      setAuthState({
        status: "error",
        message:
          "ログイン制限設定が不足しています。NEXT_PUBLIC_ALLOWED_AUTH_EMAILS または VITE_ALLOWED_AUTH_EMAILS に許可メールアドレスを設定してください。",
      });
      return;
    }

    const allowedEmails = parseAllowedEmails(allowedConfig);
    const isInIframe = typeof window !== "undefined" && window.self !== window.top;

    if (isInIframe) {
      let received = false;

      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        if (event.data?.type === "AUTH_HINT" && event.data?.loginHint) {
          received = true;
          const loginHint = String(event.data.loginHint).trim().toLowerCase();
          const name = event.data.name;

          if (isEmailAllowed(loginHint, allowedEmails)) {
            setAuthState({ status: "authenticated", email: loginHint, name });
          } else {
            setAuthState({
              status: "forbidden",
              candidates: [loginHint],
              allowedConfig,
            });
          }
        }
      };

      window.addEventListener("message", handleMessage);

      try {
        window.parent.postMessage({ type: "AUTH_HINT_REQUEST" }, "*");
      } catch (e) {
        console.warn("postMessage to window.parent failed:", e);
      }

      const timeoutId = setTimeout(() => {
        if (!received) {
          setAuthState({
            status: "error",
            message:
              "ポータルから認証情報を取得できませんでした。ポータル側でログイン済みか確認してください。",
          });
        }
      }, 5000);

      return () => {
        window.removeEventListener("message", handleMessage);
        clearTimeout(timeoutId);
      };
    } else {
      const initAuth = async () => {
        try {
          await instance.initialize();
          const redirectResponse = await instance.handleRedirectPromise().catch((err) => {
            console.error("handleRedirectPromise error:", err);
            return null;
          });

          if (redirectResponse && redirectResponse.account) {
            instance.setActiveAccount(redirectResponse.account);
          }

          const activeAccount = instance.getActiveAccount();
          const allAccounts = instance.getAllAccounts();
          const targetAccount =
            activeAccount || (allAccounts.length > 0 ? allAccounts[0] : null);

          if (targetAccount) {
            instance.setActiveAccount(targetAccount);
            const candidates = getAccountEmailCandidates(targetAccount);
            const allowed = candidates.find((c) => isEmailAllowed(c, allowedEmails));
            if (allowed) {
              setAuthState({
                status: "authenticated",
                email: allowed,
                name: targetAccount.name,
              });
            } else {
              setAuthState({
                status: "forbidden",
                candidates,
                allowedConfig,
              });
            }
            return;
          }

          try {
            const ssoPromise = instance.ssoSilent(ssoSilentRequest);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("ssoSilent timeout")), 5000)
            );

            const res = await Promise.race([ssoPromise, timeoutPromise]);
            if (res && res.account) {
              instance.setActiveAccount(res.account);
              const candidates = getAccountEmailCandidates(res.account);
              const allowed = candidates.find((c) => isEmailAllowed(c, allowedEmails));
              if (allowed) {
                setAuthState({
                  status: "authenticated",
                  email: allowed,
                  name: res.account.name,
                });
              } else {
                setAuthState({
                  status: "forbidden",
                  candidates,
                  allowedConfig,
                });
              }
              return;
            }
          } catch (ssoErr) {
            console.warn("ssoSilent failed:", ssoErr);
          }

          setAuthState({ status: "unauthenticated" });
        } catch (err) {
          console.error("MSAL init error:", err);
          setAuthState({
            status: "error",
            message: "認証初期化中にエラーが発生しました。",
          });
        }
      };

      initAuth();
    }
  }, [instance]);

  if (authState.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 p-4">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-400 text-sm">認証状態を確認中...</p>
        </div>
      </div>
    );
  }

  if (authState.status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 p-6">
        <div className="max-w-md w-full bg-slate-800 border border-red-500/30 rounded-xl p-6 text-center space-y-4">
          <div className="w-12 h-12 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
            !
          </div>
          <h2 className="text-lg font-bold text-slate-100">設定・認証エラー</h2>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{authState.message}</p>
        </div>
      </div>
    );
  }

  if (authState.status === "forbidden") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 p-6">
        <div className="max-w-lg w-full bg-slate-800 border border-amber-500/30 rounded-xl p-6 space-y-5">
          <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
            ✕
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold text-slate-100">アプリを表示できません</h2>
            <p className="text-sm text-slate-300">
              ログインユーザーはこのアプリの利用が許可されていません。
            </p>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-4 text-xs font-mono space-y-2 border border-slate-700">
            <div>
              <span className="text-slate-400">判定対象メール: </span>
              <span className="text-amber-300">
                {authState.candidates.length > 0 ? authState.candidates.join(", ") : "（なし）"}
              </span>
            </div>
            <div>
              <span className="text-slate-400">現在の許可設定: </span>
              <span className="text-slate-200">{authState.allowedConfig}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (authState.status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 p-6">
        <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-xl p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-indigo-500/10 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 002-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-100">定例会議ワークスペース</h2>
            <p className="text-sm text-slate-400">
              利用を開始するにはMicrosoftアカウントでログインしてください。
            </p>
          </div>
          <button
            onClick={() => instance.loginRedirect(loginRequest).catch(console.error)}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            <span>Microsoftでサインイン</span>
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
