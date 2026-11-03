import { NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth";
import { env } from "@/lib/config";
import { runCron } from "@/lib/workflow";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 由 cron-job.org（?secret=...）或 Vercel Cron（Authorization: Bearer ...）定時呼叫
async function handle(req: Request) {
  const url = new URL(req.url);
  const given =
    url.searchParams.get("secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let expected: string;
  try {
    expected = env.cronSecret();
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
  if (!safeEqual(given, expected)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  try {
    const report = await runCron();
    return NextResponse.json({ ok: true, at: new Date().toISOString(), ...report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
