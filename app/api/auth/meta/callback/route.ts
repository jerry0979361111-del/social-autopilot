import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { completeLogin } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/posts?${q}`, url));
  const jar = await cookies();
  const expected = jar.get("meta_oauth_state")?.value;
  jar.delete("meta_oauth_state");

  if (url.searchParams.get("error")) {
    return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? "已取消授權")}`);
  }
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) {
    return back(`error=${encodeURIComponent("授權驗證失敗，請重新按「連接 Meta 帳號」")}`);
  }
  try {
    const conn = await completeLogin(code);
    return back(`notice=${encodeURIComponent(`已連接 Meta：${conn.pages.length} 個粉專`)}`);
  } catch (e: any) {
    return back(`error=${encodeURIComponent(String(e?.message ?? e))}`);
  }
}
