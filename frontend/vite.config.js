import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:5001",
        changeOrigin: true,
      },
      "/uploads": {
        target: "http://localhost:5001",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:5001",
        ws: true, // 👈 QUAN TRỌNG: bật websocket proxy
        changeOrigin: true,
      },
    },
  },
  build: {
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true },
    },
  },
});
