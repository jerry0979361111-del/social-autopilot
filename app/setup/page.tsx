import { Alerts } from "@/app/components/Alerts";
import { SubmitButton } from "@/app/components/SubmitButton";
import { runChecks } from "@/lib/health";
import { testEmail } from "./actions";

export const dynamic = "force-dynamic";

export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  const checks = await runChecks();
  const base = (process.env.NEXT_PUBLIC_BASE_URL ?? "https://你的網址").replace(/\/+$/, "");
  return (
    <>
      <h1>設定檢查</h1>
      <Alerts error={error} notice={notice} />
      <section className="card">
        <table>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td style={{ width: 28 }}>{c.ok ? "✅" : "❌"}</td>
                <td style={{ width: 180 }}>{c.name}</td>
                <td className={c.ok ? "" : "err"}>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Email 通知</h2>
        <form action={testEmail}>
          <SubmitButton pendingText="寄送中…">寄一封測試信</SubmitButton>
        </form>
      </section>
      <section className="card">
        <h2>要填到其他服務的網址</h2>
        <label>Meta App → Facebook 登入 → 設定 → 有效的 OAuth 重新導向 URI</label>
        <input type="text" readOnly value={`${base}/api/auth/meta/callback`} />
        <label>cron-job.org 的 URL（每 30 分鐘；把最後換成你的 CRON_SECRET）</label>
        <input type="text" readOnly value={`${base}/api/cron/publish?secret=你的CRON_SECRET`} />
      </section>
    </>
  );
}
