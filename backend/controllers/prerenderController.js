// controllers/prerenderController.js — Prerender SPA cho crawler.
//
// Cách dùng: nginx detect UA crawler (googlebot/facebookexternalhit/zalo/...)
// → rewrite request `/tournament/xxx` thành `/prerender/tournament/xxx` →
// proxy tới backend. Endpoint dưới đây launch puppeteer, navigate URL thật
// (với browser UA để nginx không rewrite lại → tránh loop), đợi React
// render xong, trả HTML với title/description/OG/JSON-LD đã populate.
//
// Cache in-memory 1 giờ. Browser singleton reuse giữa các request.

import puppeteer from "puppeteer";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 300 });

const SITE_ORIGIN = process.env.PRERENDER_ORIGIN || "https://pickletour.vn";
// UA browser thật để nginx không detect là bot → không rewrite lại → không loop.
const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Prerender";

// Static extension → không cần prerender (nếu request lọt qua nginx UA map)
const STATIC_EXTS = new Set([
  ".html", ".htm", ".js", ".css", ".map", ".xml", ".json",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".pdf", ".mp3", ".mp4", ".m4a", ".mov", ".webm",
  ".webmanifest", ".woff", ".woff2", ".ttf", ".txt",
]);

// Path prefix không cần prerender (auth-gated pages hoặc API)
const SKIP_PATH_PREFIXES = [
  "/api/",
  "/admin/",
  "/uploads/",
  "/socket.io/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/me",
  "/account",
];

let browserPromise = null;

async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      // Test alive
      if (b.isConnected()) return b;
    } catch {
      // fallthrough
    }
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
      "--single-process",
    ],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    timeout: 30000,
  });
  const browser = await browserPromise;
  browser.on("disconnected", () => {
    browserPromise = null;
  });
  return browser;
}

function shouldSkip(path) {
  const lower = String(path || "").toLowerCase();
  if (SKIP_PATH_PREFIXES.some((p) => lower.startsWith(p))) return true;
  const dot = lower.lastIndexOf(".");
  if (dot > 0) {
    const ext = lower.slice(dot);
    if (STATIC_EXTS.has(ext)) return true;
  }
  return false;
}

/**
 * GET /prerender/*
 * Nginx forward tới đây với UA gốc là bot. Server sẽ:
 * 1. Extract path gốc từ URL (bỏ /prerender prefix)
 * 2. Check cache
 * 3. Launch puppeteer, navigate với UA browser, đợi network idle
 * 4. Trả HTML kèm header X-Prerender: 1 để debug
 */
export const prerenderHandler = async (req, res) => {
  // req.url có dạng /prerender/tournament/xxx?a=1 → strip prefix
  const originalUrl = req.originalUrl || req.url;
  const path =
    originalUrl.replace(/^\/prerender/, "") || "/";

  if (shouldSkip(path)) {
    res.status(400).type("text/plain").send("Not prerenderable");
    return;
  }

  const url = `${SITE_ORIGIN}${path}`;
  const cacheKey = `pr:${path}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "X-Prerender": "hit",
      "Cache-Control": "public, max-age=600",
    });
    return res.send(cached);
  }

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1280, height: 800 });

    // Block image/font/media để render nhanh (chỉ cần HTML + meta)
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const type = r.resourceType();
      if (
        type === "image" ||
        type === "font" ||
        type === "media" ||
        type === "websocket"
      ) {
        return r.abort();
      }
      return r.continue();
    });

    await page.goto(url, {
      waitUntil: "networkidle0",
      timeout: 20000,
    });

    // Đợi react-helmet-async flush title/canonical/og dynamic. Test cho
    // thấy 200ms không đủ cho các trang cần fetch nhiều query — 800ms an
    // toàn. Ngoài ra chờ tới khi document.title khác default (nghĩa là
    // SEOHead đã render với data thật).
    try {
      await page.waitForFunction(
        () =>
          document.title &&
          !document.title.includes(
            "Pickletour.vn - Kết nối cộng đồng",
          ),
        { timeout: 3000 },
      );
    } catch {
      /* nếu title vẫn default sau 3s, cứ trả về (better than nothing) */
    }
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 300)),
    );

    const html = await page.content();

    cache.set(cacheKey, html);
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "X-Prerender": "miss",
      "Cache-Control": "public, max-age=600",
    });
    return res.send(html);
  } catch (err) {
    console.error(
      "[prerender] error for",
      url,
      ":",
      err?.message || err,
    );
    // Fallback: redirect crawler tới URL gốc (họ sẽ nhận index.html chung
    // — tệ nhưng không 500).
    res.set({ "X-Prerender": "error" });
    return res.redirect(302, path);
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
  }
};

// Health check cho debug: /prerender/_health
export const prerenderHealth = async (_req, res) => {
  const stats = cache.getStats();
  const keys = cache.keys();
  res.json({
    ok: true,
    cache: {
      keys: keys.length,
      hits: stats.hits,
      misses: stats.misses,
      ksize: stats.ksize,
      vsize: stats.vsize,
    },
    browserAlive: !!browserPromise,
  });
};
