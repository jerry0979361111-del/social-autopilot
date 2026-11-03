// 選填的網站登入密碼（APP_PASSWORD）。cookie 存的是密碼的雜湊，不是密碼本身。

export const AUTH_COOKIE = "sa_auth";

export async function passwordToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`social-autopilot:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
