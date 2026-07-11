import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

async function resolveSentryVitePlugin() {
  try {
    const mod = await import("@sentry/vite-plugin");
    return mod.sentryVitePlugin;
  } catch {
    return null;
  }
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Dev proxy target: đặt VITE_DEV_PROXY_TARGET=https://pickletour.vn trong .env
  // để dev UI ăn data server thật; bỏ trống thì về backend local như cũ.
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || "http://localhost:5001";
  const sentryVitePlugin = await resolveSentryVitePlugin();
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN;
  const sentryOrg = env.SENTRY_ORG || process.env.SENTRY_ORG;
  const sentryProject = env.SENTRY_PROJECT || process.env.SENTRY_PROJECT;
  const sentryRelease =
    env.SENTRY_RELEASE ||
    env.VITE_SENTRY_RELEASE ||
    process.env.SENTRY_RELEASE ||
    process.env.VITE_SENTRY_RELEASE;

  const enableSentrySourcemaps = Boolean(
    sentryVitePlugin &&
      sentryAuthToken &&
      sentryOrg &&
      sentryProject &&
      sentryRelease
  );

  const plugins = [react()];

  plugins.push(
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: [
        "favicon-64.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "icon-chatbot-192.png",
        "vite.svg",
      ],
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: [],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images-cache",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 2 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
      manifest: {
        name: "Pickletour.vn",
        short_name: "Pickletour",
        description: "Nen tang quan ly giai dau Pickleball hang dau Viet Nam",
        theme_color: "#0d6efd",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
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
          if (req.url === "/.well-known/apple-app-site-association") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "public, max-age=3600");
          }

          if (req.url === "/.well-known/assetlinks.json") {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "public, max-age=3600");
          }

          next();
        });
      },
    },
  );

  if (enableSentrySourcemaps) {
    plugins.push(
      sentryVitePlugin({
        authToken: sentryAuthToken,
        org: sentryOrg,
        project: sentryProject,
        release: {
          name: sentryRelease,
        },
        sourcemaps: {
          assets: "./dist/**",
        },
        telemetry: false,
      })
    );
  }

  return {
    plugins,
    server: {
      port: 3000,
      proxy: {
        "/api": {
          target: devProxyTarget,
          changeOrigin: true,
          // cookie của pickletour.vn cần rewrite về localhost thì login mới dính
          cookieDomainRewrite: "localhost",
        },
        "/uploads": {
          target: devProxyTarget,
          changeOrigin: true,
        },
        "/socket.io": {
          target: devProxyTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: enableSentrySourcemaps ? "hidden" : false,
      minify: "terser",
      terserOptions: {
        compress: { drop_console: true, drop_debugger: true },
      },
      // Route đã import TĨNH (hết lỗi "Failed to fetch dynamically imported module" khi
      // điều hướng sau deploy). Nhưng gom hết vào 1 chunk thì terser minify khối ~9MB →
      // build OOM. Tách thư viện nặng ra các vendor chunk riêng để bundle chính nhẹ và
      // terser xử lý từng khối nhỏ. Các chunk vendor này nạp NGAY lúc mở app (không phải
      // lazy theo route) nên không dính lỗi 404-khi-điều-hướng. pdfmake/docx/hls vẫn để
      // dynamic import (chạy theo nút, có try/catch) nên Rollup tự tách, không cần liệt kê.
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            // Thư viện CHỈ nạp theo yêu cầu (import động: nút xuất PDF/Word, phát HLS) —
            // trả undefined để Rollup tự tạo async chunk, KHÔNG gom vào vendor nạp-sớm.
            if (
              id.includes("pdfmake") ||
              id.includes("vfs_fonts") ||
              id.includes("/docx/") ||
              id.includes("hls.js")
            )
              return undefined;
            if (id.includes("@mui") || id.includes("@emotion")) return "mui";
            if (
              id.includes("/react-dom/") ||
              id.includes("/react/") ||
              id.includes("/scheduler/") ||
              id.includes("react-router")
            )
              return "react";
            if (id.includes("@sentry")) return "sentry";
            // hls.js/pdfmake/docx KHÔNG liệt kê ở đây — chúng import động (chạy theo nút),
            // để Rollup tự tách chunk on-demand, tránh bị nạp sớm lúc mở app.
            if (
              id.includes("vidstack") ||
              id.includes("media-captions") ||
              id.includes("media-icons")
            )
              return "media";
            if (
              id.includes("react-brackets") ||
              id.includes("react-swipeable") ||
              id.includes("react-bootstrap") ||
              id.includes("react-transition-group")
            )
              return "brackets";
            if (id.includes("@reduxjs") || id.includes("react-redux") || id.includes("immer"))
              return "redux";
            return "vendor";
          },
        },
      },
    },
  };
});
