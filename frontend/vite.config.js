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
          target: "http://localhost:5001",
          changeOrigin: true,
        },
        "/uploads": {
          target: "http://localhost:5001",
          changeOrigin: true,
        },
        "/socket.io": {
          target: "http://localhost:5001",
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
    },
  };
});
