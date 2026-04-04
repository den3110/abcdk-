import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import puppeteer from "puppeteer";

const START_URL = process.env.TIKTOK_CAPTURE_START_URL || "https://www.tiktok.com/";
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  "tmp-codex-export",
  "tiktok-avatar-capture"
);
const REQUEST_LOG_PATH = path.join(OUTPUT_DIR, `requests-${RUN_STAMP}.ndjson`);
const SUMMARY_PATH = path.join(OUTPUT_DIR, `summary-${RUN_STAMP}.json`);
const PROFILE_COPY_ROOT = path.join(OUTPUT_DIR, "system-chrome-user-data");
const FALLBACK_USER_DATA_DIR = path.join(OUTPUT_DIR, "chrome-profile");
const DEBUG_PORT = Number(process.env.TIKTOK_CAPTURE_DEBUG_PORT || 9229);
const SYSTEM_CHROME_USER_DATA_DIR = path.join(
  process.env.LOCALAPPDATA || "",
  "Google",
  "Chrome",
  "User Data"
);
const SYSTEM_LOCAL_STATE_PATH = path.join(
  SYSTEM_CHROME_USER_DATA_DIR,
  "Local State"
);
const REQUEST_METHODS = new Set(["POST", "PUT", "PATCH"]);
const HOST_KEYWORDS = [
  "tiktok.com",
  "tiktokv.com",
  "byteoversea.com",
  "byteimg.com",
  "ibyteimg.com",
  "ibytedtos.com",
];
const URL_KEYWORDS = [
  "avatar",
  "profile",
  "upload",
  "picture",
  "portrait",
  "photo",
];
const BODY_KEYWORDS = [
  "avatar",
  "profile",
  "upload",
  "picture",
  "portrait",
  "photo",
];
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
const PROFILE_COPY_SKIP_SEGMENTS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "GrShaderCache",
  "ShaderCache",
  "Crashpad",
  "Service Worker",
  "blob_storage",
  "OptimizationHints",
  "BrowserMetrics",
]);

let nextId = 1;
const candidates = [];
const trackedRequests = new WeakMap();
let requestLogStream;
let finalizing = false;
let captureWindowUntil = 0;
let captureWindowReason = "idle";
let chromeProcess = null;
let activeBrowser = null;
let selectedProfileDirectory = null;
let usedSystemProfileCopy = false;

function resolveExecutablePath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  return candidates.find((file) => fs.existsSync(file));
}

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

function clipText(value, limit = 800) {
  if (!value) return null;
  const singleLine = String(value).replace(/\s+/g, " ").trim();
  if (!singleLine) return null;
  return singleLine.length > limit
    ? `${singleLine.slice(0, limit)}...<truncated>`
    : singleLine;
}

function getHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostLooksRelevant(url) {
  const host = getHost(url);
  return HOST_KEYWORDS.some((entry) => host.includes(entry));
}

function keywordHits(haystack, keywords) {
  const lower = String(haystack || "").toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword));
}

function isCaptureWindowOpen() {
  return Date.now() <= captureWindowUntil;
}

function scoreCandidate({ url, contentType, postData, captureWindowOpen }) {
  let score = 0;
  const reasons = [];

  const urlHits = keywordHits(url, URL_KEYWORDS);
  if (urlHits.length) {
    score += urlHits.length * 4;
    reasons.push(`url:${urlHits.join(",")}`);
  }

  const bodyHits = keywordHits(postData, BODY_KEYWORDS);
  if (bodyHits.length) {
    score += bodyHits.length * 3;
    reasons.push(`body:${bodyHits.join(",")}`);
  }

  const lowerContentType = String(contentType || "").toLowerCase();
  if (lowerContentType.includes("multipart/form-data")) {
    score += 5;
    reasons.push("content-type:multipart");
  }

  if (lowerContentType.includes("image/")) {
    score += 4;
    reasons.push("content-type:image");
  }

  if (captureWindowOpen) {
    score += 3;
    reasons.push(`capture-window:${captureWindowReason}`);
  }

  return { score, reasons };
}

function summarizePostData(postData, contentType) {
  if (!postData) {
    return { length: 0, preview: null };
  }

  return {
    length: postData.length,
    preview: clipText(
      String(contentType || "").toLowerCase().includes("multipart/form-data")
        ? postData.slice(0, 300)
        : postData,
      800
    ),
  };
}

function shouldTrackRequest({ url, method, contentType, postData }) {
  if (!REQUEST_METHODS.has(method)) {
    return false;
  }

  if (!hostLooksRelevant(url)) {
    return false;
  }

  if (isCaptureWindowOpen()) {
    return true;
  }

  const lowerContentType = String(contentType || "").toLowerCase();
  const lowerUrl = String(url || "").toLowerCase();
  const lowerBody = String(postData || "").toLowerCase();

  return (
    URL_KEYWORDS.some((keyword) => lowerUrl.includes(keyword)) ||
    BODY_KEYWORDS.some((keyword) => lowerBody.includes(keyword)) ||
    lowerContentType.includes("multipart/form-data") ||
    lowerContentType.includes("image/") ||
    lowerUrl.includes("imagex") ||
    lowerUrl.includes("upload")
  );
}

function writeLogLine(payload) {
  return new Promise((resolve, reject) => {
    requestLogStream.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function extendCaptureWindow(reason, durationMs = 120000) {
  captureWindowUntil = Date.now() + durationMs;
  captureWindowReason = reason;
  await writeLogLine({
    type: "capture_window",
    at: new Date().toISOString(),
    reason,
    until: new Date(captureWindowUntil).toISOString(),
  }).catch(() => {});
}

function shouldCopyProfilePath(sourcePath, profileRoot) {
  if (sourcePath === profileRoot) {
    return true;
  }

  const relativePath = path.relative(profileRoot, sourcePath);
  if (!relativePath) {
    return true;
  }

  const segments = relativePath.split(path.sep);
  return !segments.some((segment) => PROFILE_COPY_SKIP_SEGMENTS.has(segment));
}

async function copyTreeLoose(sourcePath, destinationPath, profileRoot) {
  if (!shouldCopyProfilePath(sourcePath, profileRoot)) {
    return;
  }

  const stats = await fsp.lstat(sourcePath).catch(() => null);
  if (!stats) {
    return;
  }

  if (stats.isSymbolicLink()) {
    return;
  }

  if (stats.isDirectory()) {
    await fsp.mkdir(destinationPath, { recursive: true }).catch(() => {});
    const entries = await fsp
      .readdir(sourcePath, { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      await copyTreeLoose(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name),
        profileRoot
      );
    }

    return;
  }

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true }).catch(() => {});
  await fsp.copyFile(sourcePath, destinationPath).catch(() => {});
}

async function detectSystemProfileDirectory() {
  const requestedProfile = process.env.TIKTOK_CAPTURE_CHROME_PROFILE;
  if (requestedProfile) {
    return requestedProfile;
  }

  if (!fs.existsSync(SYSTEM_LOCAL_STATE_PATH)) {
    return null;
  }

  try {
    const localState = JSON.parse(
      await fsp.readFile(SYSTEM_LOCAL_STATE_PATH, "utf8")
    );
    return localState?.profile?.last_used || "Default";
  } catch {
    return "Default";
  }
}

async function prepareUserDataDir() {
  const profileDirectory = await detectSystemProfileDirectory();
  const sourceProfilePath = profileDirectory
    ? path.join(SYSTEM_CHROME_USER_DATA_DIR, profileDirectory)
    : null;

  if (
    process.env.TIKTOK_CAPTURE_DISABLE_PROFILE_COPY === "1" ||
    !profileDirectory ||
    !sourceProfilePath ||
    !fs.existsSync(sourceProfilePath)
  ) {
    selectedProfileDirectory = null;
    usedSystemProfileCopy = false;
    return {
      userDataDir: FALLBACK_USER_DATA_DIR,
      profileDirectory: null,
    };
  }

  await fsp.rm(PROFILE_COPY_ROOT, { recursive: true, force: true });
  await fsp.mkdir(PROFILE_COPY_ROOT, { recursive: true });

  if (fs.existsSync(SYSTEM_LOCAL_STATE_PATH)) {
    await fsp
      .copyFile(
        SYSTEM_LOCAL_STATE_PATH,
        path.join(PROFILE_COPY_ROOT, "Local State")
      )
      .catch(() => {});
  }

  await copyTreeLoose(
    sourceProfilePath,
    path.join(PROFILE_COPY_ROOT, profileDirectory),
    sourceProfilePath
  );

  selectedProfileDirectory = profileDirectory;
  usedSystemProfileCopy = true;

  return {
    userDataDir: PROFILE_COPY_ROOT,
    profileDirectory,
  };
}

function launchChrome({
  executablePath,
  userDataDir,
  profileDirectory,
  startUrl,
}) {
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--start-maximized",
    startUrl,
  ];

  if (profileDirectory) {
    args.splice(args.length - 1, 0, `--profile-directory=${profileDirectory}`);
  }

  chromeProcess = spawn(executablePath, args, {
    stdio: "ignore",
    windowsHide: false,
  });

  chromeProcess.on("exit", () => {
    chromeProcess = null;
  });
}

async function connectToBrowser() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      return await puppeteer.connect({
        browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
        defaultViewport: null,
      });
    } catch {
      await delay(1000);
    }
  }

  throw new Error("Chrome did not expose the remote debugging endpoint in time.");
}

async function finalize(reason) {
  if (finalizing) return;
  finalizing = true;

  try {
    const summary = {
      reason,
      startedAt: RUN_STAMP,
      outputDir: OUTPUT_DIR,
      totalCandidates: candidates.length,
      selectedProfileDirectory,
      usedSystemProfileCopy,
      topCandidates: [...candidates]
        .sort((a, b) => b.score - a.score)
        .slice(0, 12),
    };

    await fsp.writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2), "utf8");
    console.log(`Saved summary: ${SUMMARY_PATH}`);
    console.log(`Saved raw requests: ${REQUEST_LOG_PATH}`);
  } finally {
    await new Promise((resolve) => requestLogStream.end(resolve));

    if (activeBrowser?.connected) {
      await activeBrowser.close().catch(() => {});
    }

    if (chromeProcess) {
      try {
        chromeProcess.kill();
      } catch {}
    }
  }
}

function bindPage(page) {
  if (page.__tiktokCaptureBound) return;
  page.__tiktokCaptureBound = true;

  page.on("filechooser", async () => {
    await extendCaptureWindow("filechooser");
    await writeLogLine({
      type: "filechooser",
      at: new Date().toISOString(),
      pageUrl: page.url(),
    }).catch(() => {});
  });

  page.on("framenavigated", async (frame) => {
    if (frame !== page.mainFrame()) {
      return;
    }

    const url = frame.url();
    const lowerUrl = url.toLowerCase();
    if (
      lowerUrl.includes("/profile") ||
      lowerUrl.includes("/settings") ||
      lowerUrl.includes("avatar")
    ) {
      await extendCaptureWindow(`navigation:${clipText(url, 120)}`, 120000);
    }
  });

  page.on("request", async (request) => {
    const method = request.method();
    let postData = "";

    try {
      postData = request.postData() || "";
    } catch {
      postData = "";
    }

    const headers = request.headers();
    const contentType = headers["content-type"] || "";

    if (
      !shouldTrackRequest({
        url: request.url(),
        method,
        contentType,
        postData,
      })
    ) {
      return;
    }

    const record = {
      id: nextId++,
      type: "request",
      at: new Date().toISOString(),
      pageUrl: page.url(),
      url: request.url(),
      method,
      resourceType: request.resourceType(),
      contentType,
      headers: sanitizeHeaders(headers),
      postData: summarizePostData(postData, contentType),
      captureWindowOpen: isCaptureWindowOpen(),
    };
    const { score, reasons } = scoreCandidate({
      url: record.url,
      contentType,
      postData,
      captureWindowOpen: record.captureWindowOpen,
    });
    record.score = score;
    record.reasons = reasons;

    trackedRequests.set(request, record);
    candidates.push(record);
    await writeLogLine(record);
  });

  page.on("response", async (response) => {
    const request = response.request();
    const requestRecord = trackedRequests.get(request);
    if (!requestRecord) {
      return;
    }

    const responseRecord = {
      type: "response",
      requestId: requestRecord.id,
      at: new Date().toISOString(),
      url: response.url(),
      status: response.status(),
      ok: response.ok(),
      headers: sanitizeHeaders(response.headers()),
    };

    requestRecord.response = {
      status: responseRecord.status,
      ok: responseRecord.ok,
      headers: responseRecord.headers,
    };

    await writeLogLine(responseRecord);
  });
}

async function main() {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true });
  requestLogStream = fs.createWriteStream(REQUEST_LOG_PATH, { flags: "a" });

  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    throw new Error("Chrome or Edge executable was not found.");
  }

  const { userDataDir, profileDirectory } = await prepareUserDataDir();
  await fsp.mkdir(userDataDir, { recursive: true });

  await writeLogLine({
    type: "session",
    at: new Date().toISOString(),
    executablePath,
    startUrl: START_URL,
    userDataDir,
    profileDirectory,
    usedSystemProfileCopy,
    debugPort: DEBUG_PORT,
  });

  launchChrome({
    executablePath,
    userDataDir,
    profileDirectory,
    startUrl: START_URL,
  });

  const browser = await connectToBrowser();
  activeBrowser = browser;

  browser.on("targetcreated", async (target) => {
    const page = await target.page().catch(() => null);
    if (page) bindPage(page);
  });

  browser.on("disconnected", () => {
    finalize("browser_disconnected").catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });

  const pages = await browser.pages();
  if (pages.length === 0) {
    const page = await browser.newPage();
    await page.goto(START_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    bindPage(page);
  } else {
    for (const page of pages) {
      bindPage(page);
    }
  }

  console.log("TikTok capture browser is open.");
  console.log("1. If TikTok is already logged in, go straight to the profile/avatar edit screen.");
  console.log("2. If not, try to log in with the copied Chrome profile state.");
  console.log("3. Click change avatar and select a file.");
  console.log("4. Close the browser when done.");
  console.log(`Output directory: ${OUTPUT_DIR}`);
  if (profileDirectory) {
    console.log(`Copied Chrome profile: ${profileDirectory}`);
  }
}

process.on("SIGINT", () => {
  finalize("sigint").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});

process.on("SIGTERM", () => {
  finalize("sigterm").catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});

main().catch(async (error) => {
  console.error(error);
  if (requestLogStream) {
    await new Promise((resolve) => requestLogStream.end(resolve));
  }
  process.exitCode = 1;
});
