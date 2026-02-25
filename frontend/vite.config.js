import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.png", "vite.svg"],
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB
        // Chỉ precache các file static (JS, CSS, HTML, fonts, images)
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff,woff2}",
        ],
        // Loại bỏ API và các route động khỏi cache
        navigateFallbackDenylist: [/^\/api/, /^\/uploads/, /^\/socket\.io/],
        runtimeCaching: [
          {
            // API calls - luôn lấy từ network, không cache
            urlPattern: /^https?:\/\/.*\/api\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Uploads - luôn lấy từ network
            urlPattern: /^https?:\/\/.*\/uploads\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Socket.io - không cache
            urlPattern: /^https?:\/\/.*\/socket\.io\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Cache ảnh từ CDN/external với stale-while-revalidate
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 ngày
              },
            },
          },
        ],
      },
      manifest: {
        name: "Pickletour.vn",
        short_name: "Pickletour",
        description: "Nền tảng quản lý giải đấu Pickleball hàng đầu Việt Nam",
        theme_color: "#0d6efd",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          {
            src: "/icon.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
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
