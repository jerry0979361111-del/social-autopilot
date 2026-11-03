import { Alerts } from "@/app/components/Alerts";
import { SubmitButton } from "@/app/components/SubmitButton";
import type { NotionRecord } from "@/lib/notion";
import { formatTaipei, WEEKDAYS } from "@/lib/time";
import { PLATFORM_LABEL, type AutomationData } from "@/lib/types";
import { listAutomations } from "@/lib/workflow";
import { deleteAutomation, runNow, saveAutomation } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_NAME = process.env.NEXT_PUBLIC_AUTOMATION_DEFAULT_NAME || "每週三次 · 產業小知識";
const DEFAULT_THEME =
  process.env.NEXT_PUBLIC_AUTOMATION_DEFAULT_THEME || "搜集產業最新趨勢，整理成一則適合 IG 的小知識貼文。";

function AutomationForm({ rec }: { rec?: NotionRecord<AutomationData> }) {
  const a = rec?.data;
  return (
    <form action={saveAutomation}>
      {rec && <input type="hidden" name="id" value={rec.id} />}
      <label>任務名稱</label>
      <input type="text" name="name" defaultValue={a?.name ?? DEFAULT_NAME} required />
      <label>主題／指示（AI 每次會依這段產生一則新貼文）</label>
      <textarea name="theme" defaultValue={a?.theme ?? DEFAULT_THEME} required style={{ minHeight: 80 }} />
      <label>星期</label>
      <div>
        {WEEKDAYS.map((w, i) => (
          <label key={i} className="inline">
            <input type="checkbox" name="days" value={i} defaultChecked={a ? a.days.includes(i) : [1, 3, 5].includes(i)} /> 週{w}
          </label>
        ))}
      </div>
      <label>時間（台北時間，可填多個，用逗號分隔）</label>
      <input type="text" name="times" defaultValue={a?.times.join(", ") ?? "09:00"} placeholder="09:00, 18:30" />
      <div style={{ marginTop: 8 }}>
        <label className="inline"><input type="checkbox" name="platforms" value="ig" defaultChecked={a ? a.platforms.includes("ig") : true} /> Instagram</label>
        <label className="inline"><input type="checkbox" name="platforms" value="fb" defaultChecked={a ? a.platforms.includes("fb") : true} /> Facebook</label>
        <label className="inline"><input type="checkbox" name="withImage" defaultChecked={a ? a.withImage : true} /> AI 生成配圖</label>
        <label className="inline"><input type="checkbox" name="webSearch" defaultChecked={a ? a.webSearch : true} /> 上網搜尋最新資訊</label>
        <label className="inline"><input type="checkbox" name="enabled" defaultChecked={a ? a.enabled : true} /> 啟用</label>
      </div>
      <p>
        <SubmitButton className="primary">{rec ? "儲存變更" : "新增任務"}</SubmitButton>
      </p>
    </form>
  );
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  let loadError: string | undefined;
  let items: NotionRecord<AutomationData>[] = [];
  try {
    items = await listAutomations();
  } catch (e: any) {
    loadError = String(e?.message ?? e);
  }

  return (
    <>
      <h1>自動化任務</h1>
      <Alerts error={error ?? loadError} notice={notice} />
      <p className="muted">
        到了設定的時段，系統會自動產文、產圖並發布。需要 cron 每 30 分鐘呼叫一次，所以實際發出時間會落在設定時間後 30 分鐘內。
        若某次全平台都失敗，會在下一次自動重試（24 小時內），只要任一平台成功就不會重複發文。
      </p>

      {items.map((rec) => {
        const a = rec.data;
        return (
          <section key={rec.id} className="card">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>{a.name}</h2>
              <span className={`badge ${a.enabled ? "ok" : "muted"}`}>{a.enabled ? "啟用中" : "已停用"}</span>
            </div>
            <p className="muted">
              每週{a.days.map((d) => WEEKDAYS[d]).join("、")} {a.times.join("、")} ·{" "}
              {a.platforms.map((p) => PLATFORM_LABEL[p]).join(" + ")} · 上次完成時段 {formatTaipei(a.lastDoneSlot)}
            </p>
            <div className="actions">
              <form action={runNow}>
                <input type="hidden" name="id" value={rec.id} />
                <SubmitButton pendingText="產文產圖並發布中…" confirm="會立刻產生並發布一則貼文，確定嗎？">
                  立即執行一次
                </SubmitButton>
              </form>
              <form action={deleteAutomation}>
                <input type="hidden" name="id" value={rec.id} />
                <SubmitButton className="danger" confirm="確定刪除這個任務？">刪除</SubmitButton>
              </form>
            </div>
            <details style={{ marginTop: 8 }}>
              <summary>編輯</summary>
              <AutomationForm rec={rec} />
            </details>
            <details style={{ marginTop: 8 }}>
              <summary>執行紀錄（最近 20 筆）</summary>
              {a.runs?.length ? (
                <table>
                  <thead>
                    <tr><th>執行時間</th><th>時段</th><th>結果</th></tr>
                  </thead>
                  <tbody>
                    {a.runs.map((r, i) => (
                      <tr key={i}>
                        <td>{formatTaipei(r.at)}</td>
                        <td>{r.slot === "手動執行" ? r.slot : formatTaipei(r.slot)}</td>
                        <td className={r.ok ? "ok" : "err"}>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">尚無紀錄</p>
              )}
            </details>
          </section>
        );
      })}

      <section className="card">
        <h2>新增任務</h2>
        <AutomationForm />
      </section>
    </>
  );
}
