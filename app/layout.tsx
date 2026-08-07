import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "定例会議ワークスペース",
  description:
    "AIが報告を問題・判断・理由・確認事項に整理し、報告会議を判断の場へ変えるワークスペース。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "定例会議ワークスペース",
    description: "AIで報告を、判断できる形へ。判断準備率10％から50％を目指します。",
    type: "website",
    locale: "ja_JP",
    images: ["/og-decision.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "定例会議ワークスペース",
    description: "AIで報告を、判断できる形へ。判断準備率10％から50％を目指します。",
    images: ["/og-decision.png"],
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
