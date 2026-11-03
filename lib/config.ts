// 所有設定都從環境變數讀取，換品牌不用改程式碼。

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}，請到 Vercel → Settings → Environment Variables 設定後 Redeploy`);
  return v;
}

export const env = {
  baseUrl: () => required("NEXT_PUBLIC_BASE_URL").replace(/\/+$/, ""),
  notionKey: () => required("NOTION_API_KEY"),
  notionDb: () => required("NOTION_POSTS_DB_ID").replace(/-/g, ""),
  openaiKey: () => required("OPENAI_API_KEY"),
  metaAppId: () => required("META_APP_ID"),
  metaAppSecret: () => required("META_APP_SECRET"),
  cronSecret: () => required("CRON_SECRET"),
  appPassword: () => process.env.APP_PASSWORD || "",
  textModel: () => process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini",
  imageModel: () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
};

export const brand = {
  name: process.env.BRAND_NAME || "我的品牌",
  nameEn: process.env.BRAND_NAME_EN || "",
  colorPrimary: process.env.BRAND_COLOR_PRIMARY || "#1B3A5C",
  colorSecondary: process.env.BRAND_COLOR_SECONDARY || "#F2A65A",
  style: process.env.BRAND_STYLE || "乾淨、明亮、有質感的生活感攝影風格",
  tone: process.env.BRAND_TONE || "親切專業、口語自然，適度使用表情符號",
};

export const GRAPH_VERSION = "v23.0";
