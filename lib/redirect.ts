import { redirect } from "next/navigation";

/** server action 結束後帶訊息回到頁面 */
export function back(path: string, kind: "error" | "notice", message: string): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message.slice(0, 600))}`);
}
