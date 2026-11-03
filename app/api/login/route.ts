import { NextResponse } from "next/server";
import { AUTH_COOKIE, passwordToken, safeEqual } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const input = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/posts");
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/posts";
  const password = process.env.APP_PASSWORD ?? "";
  const url = new URL(req.url);

  if (!password || !safeEqual(await passwordToken(input), await passwordToken(password))) {
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(target)}`, url), 303);
  }
  const res = NextResponse.redirect(new URL(target, url), 303);
  res.cookies.set(AUTH_COOKIE, await passwordToken(password), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
