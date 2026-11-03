export function Alerts({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {error && <div className="alert err">⚠️ {error}</div>}
      {notice && <div className="alert ok">✅ {notice}</div>}
    </>
  );
}
