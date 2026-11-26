"use server";

import { sendEmail } from "@/lib/notify";
import { back } from "@/lib/redirect";

export async function testEmail() {
  const ok = await sendEmail(
    "【測試】澳洲美家社群系統 Email 通知",
    "這是一封測試信。之後有貼文需要你核准、或排程貼文發布失敗時，會寄到這個信箱。",
  );
  back("/setup", ok ? "notice" : "error", ok ? "測試信已寄出，請到信箱確認（也看一下垃圾郵件匣）" : "寄送失敗：請確認 RESEND_API_KEY 與 NOTIFY_EMAIL 已設定並重新部署");
}
