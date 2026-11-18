/** @type {import('next').NextConfig} */
const nextConfig = {
  // 配圖版型用的中文字型與 Logo，要一起打包進伺服器函式
  outputFileTracingIncludes: {
    "/**": ["./assets/**/*"],
  },
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
