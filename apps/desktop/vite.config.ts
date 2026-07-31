import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // 构建产物输出到根目录 dist/desktop，避免散落在各 app 下
  build: {
    outDir: "../../dist/desktop",
    emptyOutDir: true,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    ...(host ? {
      host,
      hmr: {
          protocol: "ws",
          host,
          port: 1421,
      }
    } : {
      host: false
    }),
  },
}));
