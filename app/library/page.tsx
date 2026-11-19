import { Alerts } from "@/app/components/Alerts";
import { SubmitButton } from "@/app/components/SubmitButton";
import { listLibrary } from "@/lib/library";
import { importDrive, importWebsite, remove, upload } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { error, notice } = await searchParams;
  let loadError: string | undefined;
  let photos: Awaited<ReturnType<typeof listLibrary>> = [];
  try {
    photos = await listLibrary();
  } catch (e: any) {
    loadError = String(e?.message ?? e);
  }

  return (
    <>
      <h1>照片庫</h1>
      <Alerts error={error ?? loadError} notice={notice} />
      <p className="muted">
        做圖時，AI 會先依文案從這裡挑最貼切的真實照片（例如文章提到某建案或區域）；沒有合適的才去公開圖庫找。
        同一張照片近期用過就不會馬上重複使用。
      </p>

      <section className="card">
        <h2>從官網匯入</h2>
        <p className="muted">匯入 mejia.au 所有建案主圖，連同建案名稱、城市、區域與簡介（已匯入的會自動略過，可重複按來同步新建案）。</p>
        <form action={importWebsite}>
          <SubmitButton className="primary" pendingText="匯入中…">匯入官網建案圖</SubmitButton>
        </form>
      </section>

      <section className="card">
        <h2>從 Google 雲端硬碟匯入</h2>
        <p className="muted">
          每行一張：「分享連結｜說明」，說明會幫 AI 判斷什麼時候用這張（例如：Balaclava Rd 建案 頂樓露台 城市景觀）。
          檔案需先設為「知道連結的任何人都能查看」。大圖會自動縮小後存起來。
        </p>
        <form action={importDrive}>
          <textarea name="links" placeholder="https://drive.google.com/file/d/xxxx/view｜Balaclava Rd 建案 外觀" style={{ minHeight: 120 }} />
          <p><SubmitButton pendingText="下載並匯入中…">匯入</SubmitButton></p>
        </form>
      </section>

      <section className="card">
        <h2>上傳照片</h2>
        <form action={upload}>
          <input type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple required />
          <label>說明（選填，套用到這次上傳的所有照片）</label>
          <input type="text" name="description" placeholder="例如：Carlton 街景、看房實拍、交房紀錄" />
          <p><SubmitButton pendingText="上傳中…">上傳</SubmitButton></p>
        </form>
      </section>

      <h2>目前照片（{photos.length}）</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {photos.map((p) => (
          <div key={p.id} className="card" style={{ padding: 8, marginBottom: 0 }}>
            <img src={p.data.url} alt="" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6 }} />
            <div style={{ fontSize: "0.9rem", marginTop: 6 }}><strong>{p.data.title}</strong></div>
            <div className="muted" style={{ fontSize: "0.8rem" }}>{p.data.source} · {p.data.description.slice(0, 60)}</div>
            <form action={remove} style={{ marginTop: 6 }}>
              <input type="hidden" name="id" value={p.id} />
              <SubmitButton className="danger" confirm="從照片庫移除這張？">移除</SubmitButton>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}
