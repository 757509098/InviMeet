import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

// 确保本地请求不经过任何系统代理
const noProxyEntries = ["localhost", "127.0.0.1", "::1"];
process.env.NO_PROXY = process.env.NO_PROXY
  ? `${process.env.NO_PROXY},${noProxyEntries.join(",")}`
  : noProxyEntries.join(",");
process.env.no_proxy = process.env.NO_PROXY;

// 预读 index.html 进内存缓存，避免在 macOS iCloud/Documents 目录下因 APFS 文件协调锁导致 readFileHandle 发生 ETIMEDOUT
let cachedIndexHtml = "";
const htmlPath = path.resolve(__dirname, "index.html");
try {
  cachedIndexHtml = fs.readFileSync(htmlPath, "utf-8");
} catch (e) {
  console.warn("[Vite] 初始预读 index.html 警告:", e);
}

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    {
      name: "instant-index-html-and-logger",
      configureServer(server) {
        // 优先拦截根路径，以内存缓存直接注入并返回 index.html，杜绝 ETIMEDOUT
        server.middlewares.use(async (req, res, next) => {
          const start = Date.now();
          const cleanPath = req.url ? req.url.split("?")[0] : "";

          if (cleanPath === "/" || cleanPath === "/index.html") {
            try {
              let html = "";
              try {
                html = fs.readFileSync(htmlPath, "utf-8");
                cachedIndexHtml = html;
              } catch (readErr) {
                console.warn("[Vite Server Log] 同步读取 index.html 降级至内存缓存:", readErr);
                html = cachedIndexHtml;
              }

              const transformed = await server.transformIndexHtml(req.url || "/", html, req.originalUrl);
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
              res.end(transformed);
              console.log(
                `[Vite Server Log] ${req.method} ${req.url} -> HTTP 200 (${Date.now() - start}ms) [秒开 index.html]`
              );
              return;
            } catch (err) {
              console.error("[Vite Server Log] 转换 index.html 失败:", err);
              next(err);
              return;
            }
          }

          res.on("finish", () => {
            console.log(
              `[Vite Server Log] ${req.method} ${req.url} -> HTTP ${res.statusCode} (${Date.now() - start}ms)`
            );
          });
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    cors: true,
    watch: {
      // 忽略 src-tauri 和 target 变动，避免触发 vite 文件监听锁
      ignored: ["**/src-tauri/**", "**/dist/**", "**/.git/**"],
    },
  },
}));

