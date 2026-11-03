// 系統固定使用台北時間（UTC+8，無夏令時間）。

const OFFSET_MS = 8 * 60 * 60 * 1000;

/** 把 <input type="datetime-local"> 的值（台北時間）轉成 ISO 字串（含 +08:00）。 */
export function taipeiLocalToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error("時間格式不正確");
  return `${local}:00.000+08:00`;
}

/** ISO → datetime-local 格式（台北時間），給表單預填用。 */
export function isoToTaipeiLocal(iso: string): string {
  const d = new Date(new Date(iso).getTime() + OFFSET_MS);
  return d.toISOString().slice(0, 16);
}

export function formatTaipei(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 台北時間的「星期幾」與日期部分。 */
function taipeiParts(ms: number) {
  const d = new Date(ms + OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() };
}

/**
 * 列出 [fromMs, toMs] 之間，符合「星期 + 時間」設定的所有排程時刻（UTC 毫秒）。
 * days: 0=週日 … 6=週六；times: "HH:MM"（台北時間）。
 */
export function slotsBetween(days: number[], times: string[], fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  for (let t = fromMs - 24 * 3600_000; t <= toMs + 24 * 3600_000; t += 24 * 3600_000) {
    const { y, m, day, weekday } = taipeiParts(t);
    if (!days.includes(weekday)) continue;
    for (const hm of times) {
      const match = /^(\d{2}):(\d{2})$/.exec(hm);
      if (!match) continue;
      const slot = Date.UTC(y, m, day, Number(match[1]), Number(match[2])) - OFFSET_MS;
      if (slot >= fromMs && slot <= toMs) out.push(slot);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
