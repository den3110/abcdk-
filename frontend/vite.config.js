import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "configure-well-known",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Apple App Site Association
          if (req.url === "/.well-known/apple-app-site-association") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "public, max-age=3600");
          }
          // Android Asset Links
          if (req.url === "/.well-known/assetlinks.json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "public, max-age=3600");
          }
          next();
        });
      },
    },
  ],
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
    minify: "terser",
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true },
    },
  },
});
