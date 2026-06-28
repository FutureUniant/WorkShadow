import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { bootSplashPlugin } from "./vite.bootSplash";

export default defineConfig({
  // Tauri 生产环境用自定义协议加载页面，必须用相对路径，否则 /assets/... 会 404 导致白屏
  base: "./",
  plugins: [react(), bootSplashPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const p = id.replace(/\\/g, "/");
          if (p.includes("@lancedb") || p.includes("apache-arrow")) return "lancedb";
          if (p.includes("@flowrag")) return "flowrag";
          if (p.includes("@tiptap") || p.includes("/prosemirror")) return "tiptap";
          if (p.includes("katex")) return "katex";
          if (
            p.includes("react-markdown") ||
            p.includes("/remark") ||
            p.includes("/rehype") ||
            p.includes("/micromark") ||
            p.includes("/unified") ||
            p.includes("/mdast-") ||
            p.includes("/hast-") ||
            p.includes("/vfile")
          ) {
            return "markdown";
          }
          if (p.includes("lucide-react")) return "icons";
          if (p.includes("/react-dom/") || p.includes("/react/") || p.includes("/scheduler/")) return "react";
          if (p.includes("i18next")) return "i18n";
          if (p.includes("@tauri-apps")) return "tauri";
          return "vendor";
        }
      }
    },
    /** 桌面端依赖体积较大；分包后单 chunk 仍可能略超 500 kB，仅作提示阈值 */
    chunkSizeWarningLimit: 1600
  },
  /** 应用静态资源统一走 src/assets 与 Vite 打包，不使用 public 目录 */
  publicDir: false,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
