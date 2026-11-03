import { NextResponse } from "next/server";
import { loginUrl } from "@/lib/meta";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const state = crypto.randomUUID();
    const res = NextResponse.redirect(loginUrl(state));
    res.cookies.set("meta_oauth_state", state, {
      httpOnly: true,
      secure: new URL(req.url).protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return res;
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/posts?error=${encodeURIComponent(e.message)}`, req.url));
  }
}
