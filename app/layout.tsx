import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "定例会議ワークスペース",
  description:
    "毎週の会議資料準備からAI議事録の確定までを一つの画面で進めるワークスペース。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "定例会議ワークスペース",
    description: "資料準備から、AI議事録の確定まで。",
    type: "website",
    locale: "ja_JP",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "定例会議ワークスペース",
    description: "資料準備から、AI議事録の確定まで。",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

import { AuthProvider } from "./AuthProvider";
import { AuthWrapper } from "./AuthWrapper";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <AuthProvider>
          <AuthWrapper>{children}</AuthWrapper>
        </AuthProvider>
      </body>
    </html>
  );
}
