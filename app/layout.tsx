import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: `${brand.name} · 社群自動發文`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body>
        <header className="nav">
          <strong>{brand.name} · 社群自動發文</strong>
          <Link href="/posts">貼文</Link>
          <Link href="/automations">自動化任務</Link>
          <Link href="/setup">設定檢查</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
