import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const DEBUG_PORT = Number(process.env.TIKTOK_CAPTURE_DEBUG_PORT || 9229);
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  "tmp-codex-export",
  "tiktok-avatar-capture"
);
const LOG_PATH = path.join(OUTPUT_DIR, `attach-requests-${RUN_STAMP}.ndjson`);
const REDACT_HEADER_PATTERNS = [
  /cookie/i,
  /auth/i,
  /token/i,
  /session/i,
  /csrf/i,
  /passport/i,
  /secret/i,
  /sid/i,
];
const INTERESTING_URL_PATTERNS = [
  /avatar/i,
  /portrait/i,
  /profile/i,
  /upload/i,
  /image/i,
  /img/i,
  /photo/i,
  /picture/i,
  /edit/i,
  /media/i,
  /tos/i,
  /imagex/i,
];
const NOISE_URL_PATTERNS = [
  /mcs-sg\.tiktokv\.com\/v1\/list/i,
  /monitor_browser\/collect\/batch/i,
  /\/tiktok\/v1\/app_open_times\/upload\//i,
  /\/tiktok\/v1\/screen_time\/upload\//i,
  /service\/2\/abtest_config/i,
  /\/v1\/user\/webid/i,
  /wallet_api_tiktok\/recharge/i,
];
const ALLOWED_METHODS = new Set(["POST", "PUT", "PATCH"]);

let nextId = 1;
let logStream;
const trackedRequests = new WeakMap();
const boundTargets = new Set();

function sanitizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(
        ([name]) =>
          !REDACT_HEADER_PATTERNS.some((pattern) => pattern.test(name))
      )
      .map(([name, value]) => [name, String(value)])
  );
}

function clipText(value, limit = 1200) {
  if (!value) return null;
  const compact = String(value).replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > limit
    ? `${compact.slice(0, limit)}...<truncated>`
    : compact;
}

function summarizePostData(postData) {
  if (!postData) {
    return { length: 0, preview: null };
  }

  return {
    length: postData.length,
    preview: clipText(postData, 1200),
  };
}

function isInterestingRequest(url) {
  return INTERESTING_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function isNoiseRequest(url) {
  return NOISE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function shouldLogRequest({ method, url }) {
  if (!ALLOWED_METHODS.has(method)) {
    return false;
  }

  if (isInterestingRequest(url)) {
    return true;
  }

  return !isNoiseRequest(url);
}

function writeLine(payload) {
  return new Promise((resolve, reject) => {
    logStream.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function bindPage(page) {
  const targetId = page.target()._targetId || page.target().url();
  if (boundTargets.has(targetId)) {
    return;
  }
  boundTargets.add(targetId);

  page.on("filechooser", async () => {
    await writeLine({
      type: "filechooser",
      at: new Date().toISOString(),
      pageUrl: page.url(),
    }).catch(() => {});
  });

  page.on("request", async (request) => {
    const method = request.method();
    if (!shouldLogRequest({ method, url: request.url() })) {
      return;
    }

    let postData = "";
    try {
      postData = request.postData() || "";
    } catch {
      postData = "";
    }

    const headers = request.headers();
    const record = {
      id: nextId++,
      type: "request",
      at: new Date().toISOString(),
      pageUrl: page.url(),
      url: request.url(),
      method,
      resourceType: request.resourceType(),
      contentType: headers["content-type"] || "",
      interesting: isInterestingRequest(request.url()),
      headers: sanitizeHeaders(headers),
      postData: summarizePostData(postData),
    };

    trackedRequests.set(request, record);
    await writeLine(record);
  });

  page.on("response", async (response) => {
    const request = response.request();
    const requestRecord = trackedRequests.get(request);
    if (!requestRecord) {
      return;
    }

    await writeLine({
      type: "response",
      requestId: requestRecord.id,
      at: new Date().toISOString(),
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
      headers: sanitizeHeaders(response.headers()),
    });
  });
}

async function main() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
    defaultViewport: null,
  });

  await writeLine({
    type: "session",
    at: new Date().toISOString(),
    debugPort: DEBUG_PORT,
    logPath: LOG_PATH,
  });

  const pages = await browser.pages();
  for (const page of pages) {
    await bindPage(page);
  }

  browser.on("targetcreated", async (target) => {
    const page = await target.page().catch(() => null);
    if (page) {
      await bindPage(page);
    }
  });

  console.log(`Attached to Chrome on port ${DEBUG_PORT}`);
  console.log(`Logging to ${LOG_PATH}`);
  console.log("Redo the avatar upload now.");
}

main().catch(async (error) => {
  console.error(error);
  if (logStream) {
    await new Promise((resolve) => logStream.end(resolve));
  }
  process.exitCode = 1;
});
