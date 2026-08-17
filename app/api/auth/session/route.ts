import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifyMicrosoftIdToken } from "../../../server-auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { idToken?: string };
    if (!body.idToken) {
      return NextResponse.json({ error: "IDトークンがありません。" }, { status: 400 });
    }

    const user = await verifyMicrosoftIdToken(body.idToken);
    const response = NextResponse.json({ email: user.email });
    response.cookies.set(AUTH_COOKIE_NAME, body.idToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
      maxAge: user.expiresAt
        ? Math.max(0, user.expiresAt - Math.floor(Date.now() / 1000))
        : 3600,
    });
    return response;
  } catch (error) {
    console.error("Microsoft session verification failed:", error);
    return NextResponse.json({ error: "Microsoft認証を確認できませんでした。" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
