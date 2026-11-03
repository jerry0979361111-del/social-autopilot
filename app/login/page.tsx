export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 360, margin: "40px auto" }}>
      <h2>請輸入密碼</h2>
      {error && <p className="err">密碼不正確</p>}
      <form method="post" action="/api/login">
        <input type="hidden" name="next" value={next ?? "/posts"} />
        <input type="password" name="password" autoFocus required />
        <p>
          <button className="primary" type="submit">登入</button>
        </p>
      </form>
    </div>
  );
}
