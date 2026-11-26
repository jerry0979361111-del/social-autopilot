import { env } from "./config";

// Email 通知（Resend）。寄件網域 mejia.au 已在 Resend 驗證，與官網共用同一個帳號。
// 需要的環境變數：RESEND_API_KEY、NOTIFY_EMAIL（多個用逗號分隔），MAIL_FROM 可省略。
// 沒設定時靜默略過，不影響發文流程。

const list = (s?: string) =>
  (s ?? "")
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function notifyConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && list(process.env.NOTIFY_EMAIL).length);
}

export async function sendEmail(subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const to = list(process.env.NOTIFY_EMAIL);
  if (!key || to.length === 0) return false;
  const send = async (from: string, rcpt: string[]) => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: rcpt, subject, text }),
        cache: "no-store",
      });
      if (!res.ok) console.error("Resend 寄信失敗", res.status, await res.text());
      return res.ok;
    } catch (e) {
      console.error("Resend 寄信失敗", e);
      return false;
    }
  };
  if (await send(process.env.MAIL_FROM || "澳洲美家社群系統 <noreply@mejia.au>", to)) return true;
  // 寄件網域有問題時，改用 Resend 測試寄件人寄到備援信箱（須是 Resend 註冊信箱）
  const fallback = list(process.env.MAIL_FALLBACK_TO);
  return fallback.length > 0 && send("澳洲美家社群系統 <onboarding@resend.dev>", fallback);
}

const siteUrl = () => {
  try {
    return env.baseUrl();
  } catch {
    return "";
  }
};

/** 有貼文等你核准 */
export async function notifyPendingApproval(
  items: { title: string; platform: string; reason: string; slot?: string; caption?: string }[],
): Promise<void> {
  if (items.length === 0 || !notifyConfigured()) return;
  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "（未定）";
  const subject =
    items.length === 1 ? `【待核准】${items[0].title}` : `【待核准】${items.length} 則社群貼文等你確認`;
  const text = [
    "以下貼文涉及簽證、稅務或法規，需要你核准後才會發布：",
    "",
    ...items.flatMap((it, i) => [
      `${i + 1}. ${it.title}`,
      `   平台：${it.platform}　原定時段：${fmt(it.slot)}`,
      `   原因：${it.reason}`,
      it.caption ? `   文案開頭：${it.caption.replace(/\s+/g, " ").slice(0, 120)}…` : "",
      "",
    ]),
    "請核對日期、規定與數字是否與官方資料一致，再到下方頁面按「核准發布」或「退回」：",
    `${siteUrl()}/posts`,
    "",
    "（原定時段已過才核准的，會在下一次排程發出）",
  ]
    .filter((l) => l !== "")
    .join("\n");
  await sendEmail(subject, text);
}

/** 排程發布失敗 */
export async function notifyPublishFailed(items: { title: string; errors: string[] }[]): Promise<void> {
  if (items.length === 0 || !notifyConfigured()) return;
  const subject = items.length === 1 ? `【發布失敗】${items[0].title}` : `【發布失敗】${items.length} 則社群貼文`;
  const text = [
    "以下排程貼文發布失敗：",
    "",
    ...items.flatMap((it, i) => [`${i + 1}. ${it.title}`, ...it.errors.map((e) => `   ${e}`), ""]),
    "可到下方頁面查看原因並按「重試發布」：",
    `${siteUrl()}/posts`,
  ].join("\n");
  await sendEmail(subject, text);
}
