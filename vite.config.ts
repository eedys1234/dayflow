import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Tauri CLI 출력이 지워지지 않도록
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 소스 변경은 cargo가 감시하므로 vite는 무시
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "chrome105",
    sourcemap: false,
    rollupOptions: {
      input: {
        // 메인 창
        main: r("index.html"),
        // 우측 하단 알림 창 (별도 WebviewWindow)
        notification: r("notification.html"),
      },
    },
  },
});
