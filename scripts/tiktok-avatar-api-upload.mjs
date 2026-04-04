import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";

const DEFAULT_DEBUG_PORT = Number(process.env.TIKTOK_CAPTURE_DEBUG_PORT || 9229);
const DEFAULT_TIMEOUT_MS = Number(process.env.TIKTOK_AVATAR_TIMEOUT_MS || 120000);
const DEFAULT_PROFILE_URL = process.env.TIKTOK_AVATAR_PROFILE_URL || "";
const APP_NAME = "tiktok_web";
const APP_LANGUAGE_FALLBACK = "vi-VN";
const APP_AID = "1988";
const DEVICE_PLATFORM = "web_pc";
const UPLOAD_SOURCE_USER_AVATAR = "0";
const TIKTOK_ORIGIN = "https://www.tiktok.com";

const MIME_BY_EXTENSION = {
  ".heic": "image/heic",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};

function printUsage() {
  console.log(`
Usage:
  node scripts/tiktok-avatar-api-upload.mjs <image-path> [--profile-url=https://www.tiktok.com/@username] [--debug-port=9229]
  npm run tiktok:avatar:upload:api -- <image-path> [--profile-url=https://www.tiktok.com/@username]

Options:
  --dry-run            Connect only, resolve runtime context, and print the target URL.
  --timeout-ms=120000  Timeout for page attach and API calls.
  --debug-port=9229    Chrome remote debugging port.
  --profile-url=...    TikTok profile page to use as runtime context.
  --help               Print this message.

Environment:
  TIKTOK_CAPTURE_DEBUG_PORT
  TIKTOK_AVATAR_TIMEOUT_MS
  TIKTOK_AVATAR_PROFILE_URL
  TIKTOK_AVATAR_IMAGE

Requirements:
  1. Chrome with your TikTok session must already be open on the remote debug port.
  2. The TikTok account must already be logged in.
  3. This script uses direct TikTok web APIs inside the page context. It does not drive the UI.
`);
}

function normalizeUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function parsePositiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return parsed;
}

function parseArgs(argv) {
  const options = {
    debugPort: DEFAULT_DEBUG_PORT,
    dryRun: process.env.TIKTOK_AVATAR_DRY_RUN === "1",
    imagePath: process.env.TIKTOK_AVATAR_IMAGE || "",
    profileUrl: DEFAULT_PROFILE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const positional = [];

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--debug-port=")) {
      options.debugPort = parsePositiveNumber(
        arg.slice("--debug-port=".length),
        "--debug-port"
      );
      continue;
    }

    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parsePositiveNumber(
        arg.slice("--timeout-ms=".length),
        "--timeout-ms"
      );
      continue;
    }

    if (arg.startsWith("--profile-url=")) {
      options.profileUrl = normalizeUrl(arg.slice("--profile-url=".length));
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unsupported option: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional[0]) {
    options.imagePath = path.resolve(process.cwd(), positional[0]);
  } else if (options.imagePath) {
    options.imagePath = path.resolve(process.cwd(), options.imagePath);
  }

  if (!options.help && !options.dryRun && !options.imagePath) {
    throw new Error("Missing image path. Use --help for usage.");
  }

  if (options.profileUrl) {
    options.profileUrl = normalizeUrl(options.profileUrl);
  }

  return options;
}

function resolveMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

function inferOs(userAgent, platform) {
  const haystack = `${userAgent || ""} ${platform || ""}`.toLowerCase();
  if (haystack.includes("windows") || haystack.includes("win32")) {
    return "windows";
  }
  if (haystack.includes("mac")) {
    return "mac";
  }
  if (haystack.includes("android")) {
    return "android";
  }
  if (haystack.includes("iphone") || haystack.includes("ipad") || haystack.includes("ios")) {
    return "ios";
  }
  if (haystack.includes("linux")) {
    return "linux";
  }
  return "windows";
}

async function connectToBrowser(debugPort) {
  try {
    return await puppeteer.connect({
      browserURL: `http://127.0.0.1:${debugPort}`,
      defaultViewport: null,
    });
  } catch (error) {
    throw new Error(
      `Could not connect to Chrome on port ${debugPort}. Open the logged-in TikTok Chrome session first.\nDetails: ${error.message}`
    );
  }
}

async function resolveTikTokPage(browser, { profileUrl, timeoutMs }) {
  const page = await browser.newPage();
  const targetUrl = profileUrl || page.url() || `${TIKTOK_ORIGIN}/`;
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  });
  await page.bringToFront().catch(() => {});

  return page;
}

async function getCookieValue(page, name) {
  const cookies = await page.cookies(TIKTOK_ORIGIN);
  return cookies.find((cookie) => cookie.name === name)?.value || "";
}

async function readRuntimeContext(page) {
  return page.evaluate(() => {
    const rehydrationElement = document.getElementById(
      "__UNIVERSAL_DATA_FOR_REHYDRATION__"
    );
    let rehydration = {};

    if (rehydrationElement?.textContent) {
      try {
        rehydration = JSON.parse(rehydrationElement.textContent);
      } catch {}
    }

    const defaultScope = rehydration?.__DEFAULT_SCOPE__ || {};
    const appContext = defaultScope["webapp.app-context"] || null;
    const verifyFpCookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith("s_v_web_id="));

    return {
      href: location.href,
      appLanguage: appContext?.language || navigator.language || "vi-VN",
      browserLanguage: navigator.language || "vi-VN",
      browserName: "Mozilla",
      browserOnline: navigator.onLine,
      browserPlatform: navigator.platform || "",
      browserVersion: navigator.userAgent || "",
      cookieEnabled: navigator.cookieEnabled,
      deviceId: appContext?.wid || "",
      focusState: document.hasFocus(),
      historyLength: history.length,
      isFullscreen: Boolean(document.fullscreenElement),
      isPageVisible: document.visibilityState === "visible",
      odinId: appContext?.odinId || appContext?.user?.uid || "",
      region: appContext?.user?.region || appContext?.region || "",
      rootReferer: document.referrer || "",
      screenHeight: screen.height || 0,
      screenWidth: screen.width || 0,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      userIsLogin: Boolean(appContext?.user?.uid),
      verifyFp: verifyFpCookie ? verifyFpCookie.slice("s_v_web_id=".length) : "",
      webcastLanguage: appContext?.language || navigator.language || "vi-VN",
      webIdLastTime: appContext?.webIdCreatedTime || "",
    };
  });
}

function buildUpdateProfilePath(context) {
  const query = new URLSearchParams({
    WebIdLastTime: String(context.webIdLastTime || ""),
    aid: APP_AID,
    app_language: context.appLanguage || APP_LANGUAGE_FALLBACK,
    app_name: APP_NAME,
    browser_language: context.browserLanguage || APP_LANGUAGE_FALLBACK,
    browser_name: context.browserName || "Mozilla",
    browser_online: String(context.browserOnline),
    browser_platform: context.browserPlatform || "",
    browser_version: context.browserVersion || "",
    channel: APP_NAME,
    cookie_enabled: String(context.cookieEnabled),
    data_collection_enabled: "true",
    device_id: String(context.deviceId || ""),
    device_platform: DEVICE_PLATFORM,
    focus_state: String(context.focusState),
    from_page: "user",
    history_len: String(context.historyLength || 0),
    is_fullscreen: String(context.isFullscreen),
    is_page_visible: String(context.isPageVisible),
    odinId: String(context.odinId || ""),
    os: inferOs(context.browserVersion, context.browserPlatform),
    priority_region: context.region || "",
    referer: context.href || "",
    region: context.region || "",
    root_referer: context.rootReferer || "",
    screen_height: String(context.screenHeight || 0),
    screen_width: String(context.screenWidth || 0),
    tz_name: context.timezone || "",
    user_is_login: String(context.userIsLogin),
    verifyFp: context.verifyFp || "",
    webcast_language: context.webcastLanguage || context.appLanguage || APP_LANGUAGE_FALLBACK,
  });

  return `/api/update/profile/?${query.toString()}`;
}

async function callAvatarApis(page, {
  fileBase64,
  fileName,
  mimeType,
  ttCsrfToken,
  updatePath,
}) {
  return page.evaluate(
    async ({ fileBase64, fileName, mimeType, ttCsrfToken, updatePath, uploadSource }) => {
      function parseJson(text) {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      }

      function assertTikTokOk(response, payload, label) {
        if (!response.ok) {
          throw new Error(`${label} failed with HTTP ${response.status}`);
        }
        if (!payload || Number(payload.status_code) !== 0) {
          throw new Error(
            `${label} failed: ${payload ? JSON.stringify(payload) : "<empty body>"}`
          );
        }
      }

      const binary = atob(fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      const uploadFormData = new FormData();
      uploadFormData.append(
        "file",
        new File([bytes], fileName, { type: mimeType })
      );
      uploadFormData.append("source", uploadSource);

      const uploadResponse = await fetch("/api/upload/image/", {
        method: "POST",
        body: uploadFormData,
      });
      const uploadText = await uploadResponse.text();
      const uploadJson = parseJson(uploadText);
      assertTikTokOk(uploadResponse, uploadJson, "upload/image");

      const avatarUri = uploadJson?.data?.uri;
      if (!avatarUri) {
        throw new Error(`upload/image response did not contain data.uri: ${uploadText}`);
      }

      const updateBody = new URLSearchParams({
        avatar_uri: avatarUri,
        tt_csrf_token: ttCsrfToken,
      }).toString();

      const updateResponse = await fetch(updatePath, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "tt-csrf-token": ttCsrfToken,
          "x-cthulhu-csrf": "1",
        },
        body: updateBody,
      });
      const updateText = await updateResponse.text();
      const updateJson = parseJson(updateText);
      assertTikTokOk(updateResponse, updateJson, "update/profile");

      return {
        avatarUri,
        updateBody,
        updatePath,
        upload: uploadJson,
        update: updateJson,
      };
    },
    {
      fileBase64,
      fileName,
      mimeType,
      ttCsrfToken,
      updatePath,
      uploadSource: UPLOAD_SOURCE_USER_AVATAR,
    }
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (options.imagePath) {
    if (!fs.existsSync(options.imagePath)) {
      throw new Error(`Image file not found: ${options.imagePath}`);
    }
    if (!fs.statSync(options.imagePath).isFile()) {
      throw new Error(`Image path is not a file: ${options.imagePath}`);
    }
  }

  const browser = await connectToBrowser(options.debugPort);
  let page;

  try {
    page = await resolveTikTokPage(browser, options);
    const runtimeContext = await readRuntimeContext(page);
    const ttCsrfToken = await getCookieValue(page, "tt_csrf_token");

    if (!runtimeContext.userIsLogin) {
      throw new Error("TikTok does not appear to be logged in on the attached Chrome session.");
    }
    if (!runtimeContext.deviceId || !runtimeContext.odinId || !runtimeContext.verifyFp) {
      throw new Error("Could not resolve TikTok runtime context (device_id, odinId, or verifyFp).");
    }
    if (!ttCsrfToken) {
      throw new Error("Could not read the tt_csrf_token cookie from the attached Chrome session.");
    }

    const updatePath = buildUpdateProfilePath(runtimeContext);

    console.log(`Using TikTok page: ${page.url()}`);
    console.log(`Update path: ${updatePath}`);

    if (options.dryRun) {
      console.log("Dry run completed. No API call was sent.");
      return;
    }

    const fileBuffer = fs.readFileSync(options.imagePath);
    const result = await callAvatarApis(page, {
      fileBase64: fileBuffer.toString("base64"),
      fileName: path.basename(options.imagePath),
      mimeType: resolveMimeType(options.imagePath),
      ttCsrfToken,
      updatePath,
    });

    console.log(`Uploaded avatar URI: ${result.avatarUri}`);
    console.log(`upload/image status_code: ${result.upload.status_code}`);
    console.log(`update/profile status_code: ${result.update.status_code}`);
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    await browser.disconnect();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
