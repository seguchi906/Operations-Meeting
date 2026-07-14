import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol =
    forwardedProtocol ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const origin = protocol + "://" + host;
  const socialImage = origin + "/og.png";

  return {
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
      images: [
        {
          url: socialImage,
          width: 1730,
          height: 909,
          alt: "定例会議ワークスペース",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "定例会議ワークスペース",
      description: "資料準備から、AI議事録の確定まで。",
      images: [socialImage],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
