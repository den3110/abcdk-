import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { fbGetLiveVideo } from "./facebookLive.service.js";
import { getValidPageToken } from "./fbTokenService.js";
import { getFacebookLiveIdentifiers } from "./liveRecordingFacebookVodShared.service.js";

const FACEBOOK_VOD_FIELDS = [
  "id",
  "status",
  "permalink_url",
  "source",
  "length",
  "title",
  "description",
  "updated_time",
  "created_time",
].join(",");
const YT_DLP_TIMEOUT_MS = 20 * 60 * 1000;
const LOCAL_YT_DLP_COMMAND_CANDIDATES = [
  path.resolve(process.cwd(), "backend", "bin", "yt-dlp.exe"),
  path.resolve(process.cwd(), "backend", "bin", "yt-dlp"),
];
const YT_DLP_COMMAND_CANDIDATES = [
  process.env.LIVE_RECORDING_FB_YTDLP_BIN,
  process.env.YT_DLP_BIN,
  ...LOCAL_YT_DLP_COMMAND_CANDIDATES,
  "yt-dlp",
  "yt-dlp.exe",
  "C:\\ProgramData\\chocolatey\\bin\\yt-dlp.exe",
].filter(Boolean);
const SIDE_CAR_EXTENSIONS = new Set([
  ".description",
  ".info.json",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".srt",
  ".vtt",
  ".part",
  ".ytdl",
]);

function asTrimmed(value) {
  return String(value || "").trim();
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function pickFacebookVodSourceUrl(payload = {}) {
  const candidates = [
    payload?.source,
    payload?.download_url,
    payload?.hd_src_no_ratelimit,
    payload?.sd_src_no_ratelimit,
    payload?.hd_src,
    payload?.sd_src,
  ];

  for (const candidate of candidates) {
    const normalized = asTrimmed(candidate);
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
  }

  return null;
}

function buildFacebookVodWatchUrl(match, fallbackPayload = null) {
  const facebook = getFacebookLiveIdentifiers(match);
  const payloadPermalink = asTrimmed(fallbackPayload?.permalink_url);
  if (payloadPermalink) return payloadPermalink;
  if (facebook.watchUrl) return facebook.watchUrl;
  if (facebook.videoId) {
    return `https://www.facebook.com/watch/?v=${encodeURIComponent(
      facebook.videoId
    )}`;
  }
  return null;
}

function createYtDlpError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function getYtDlpCookieArgs() {
  const args = [];
  const cookiesFile = asTrimmed(process.env.LIVE_RECORDING_FB_YTDLP_COOKIES_FILE);
  const cookiesFromBrowser = asTrimmed(
    process.env.LIVE_RECORDING_FB_YTDLP_COOKIES_FROM_BROWSER
  );
  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  } else if (cookiesFromBrowser) {
    args.push("--cookies-from-browser", cookiesFromBrowser);
  }
  return args;
}

function runYtDlpCommand(command, args, { timeoutMs = YT_DLP_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGKILL");
            reject(
              createYtDlpError("yt-dlp timed out", "YTDLP_TIMEOUT", {
                stdout,
                stderr,
                command,
              })
            );
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr, command });
        return;
      }
      reject(
        createYtDlpError(
          `yt-dlp exited with code ${code}`,
          "YTDLP_EXIT",
          {
            stdout,
            stderr,
            exitCode: code,
            command,
          }
        )
      );
    });
  });
}

async function runYtDlp(args, options = {}) {
  let lastError = null;
  for (const command of YT_DLP_COMMAND_CANDIDATES) {
    try {
      return await runYtDlpCommand(command, args, options);
    } catch (error) {
      const missing =
        error?.code === "ENOENT" ||
        /not recognized|cannot find|enoent/i.test(error?.message || "");
      if (missing) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw createYtDlpError(
    lastError?.message || "yt-dlp executable not found",
    "YTDLP_UNAVAILABLE",
    { cause: lastError }
  );
}

function isSideCarFile(fileName, expectedBaseName) {
  const normalized = path.basename(fileName);
  const ext = path.extname(normalized).toLowerCase();
  if (SIDE_CAR_EXTENSIONS.has(ext)) return true;
  return !normalized.startsWith(`${expectedBaseName}.`);
}

async function findDownloadedVideoPath(targetPath) {
  const dirPath = path.dirname(targetPath);
  const baseName = path.basename(targetPath, path.extname(targetPath));
  const exactPath = targetPath;
  try {
    const exactStat = await fs.promises.stat(exactPath);
    if (exactStat.isFile()) return exactPath;
  } catch (_) {}

  const entries = await fs.promises.readdir(dirPath);
  const candidates = [];

  for (const entry of entries) {
    if (isSideCarFile(entry, baseName)) continue;
    const fullPath = path.join(dirPath, entry);
    try {
      const stat = await fs.promises.stat(fullPath);
      if (stat.isFile()) {
        candidates.push({ fullPath, stat });
      }
    } catch (_) {}
  }

  candidates.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
  return candidates[0]?.fullPath || null;
}

function classifyYtDlpFailure(error) {
  const stderr = `${error?.stderr || ""}\n${error?.stdout || ""}`.toLowerCase();
  if (!stderr.trim()) {
    return error?.code || "YTDLP_FAILED";
  }
  if (stderr.includes("no video formats found")) return "YTDLP_NO_FORMATS";
  if (stderr.includes("login required")) return "YTDLP_LOGIN_REQUIRED";
  if (stderr.includes("private video")) return "YTDLP_PRIVATE_VIDEO";
  if (stderr.includes("video unavailable")) return "YTDLP_VIDEO_UNAVAILABLE";
  if (stderr.includes("requested format is not available"))
    return "YTDLP_FORMAT_UNAVAILABLE";
  return error?.code || "YTDLP_FAILED";
}

export async function resolveFacebookVodDownloadInfo(match) {
  const facebook = getFacebookLiveIdentifiers(match);
  if (!facebook.videoId) {
    throw new Error("Facebook live video id is missing");
  }

  let pageAccessToken = "";
  let tokenError = null;
  let payload = null;
  let graphError = null;

  if (facebook.pageId) {
    try {
      pageAccessToken = await getValidPageToken(facebook.pageId);
    } catch (error) {
      tokenError = error;
    }
  }

  if (!pageAccessToken && facebook.pageAccessToken) {
    pageAccessToken = facebook.pageAccessToken;
  }

  if (pageAccessToken) {
    try {
      payload = await fbGetLiveVideo({
        liveVideoId: facebook.videoId,
        pageAccessToken,
        fields: FACEBOOK_VOD_FIELDS,
      });
    } catch (error) {
      graphError = error;
    }
  }

  const sourceUrl = pickFacebookVodSourceUrl(payload);
  const permalinkUrl = buildFacebookVodWatchUrl(match, payload);
  const needsYtDlpFallback = !sourceUrl && Boolean(permalinkUrl);
  const fallbackReason = !pageAccessToken
    ? tokenError?.message || "Facebook page access token is unavailable"
    : graphError?.message || null;

  return {
    ready: Boolean(sourceUrl || needsYtDlpFallback),
    sourceUrl,
    downloadMethod: sourceUrl ? "graph_source" : needsYtDlpFallback ? "yt_dlp" : null,
    ytDlpUrl: needsYtDlpFallback ? permalinkUrl : null,
    durationSeconds: toPositiveNumber(payload?.length),
    title: asTrimmed(payload?.title) || null,
    status: asTrimmed(payload?.status) || facebook.status || null,
    permalinkUrl,
    pageAccessToken: pageAccessToken || null,
    pageId: facebook.pageId,
    videoId: facebook.videoId,
    graphError:
      graphError?.message || (!sourceUrl && fallbackReason ? fallbackReason : null),
    raw: payload,
  };
}

export async function downloadFacebookVodToFile({ sourceUrl, targetPath }) {
  const normalizedUrl = asTrimmed(sourceUrl);
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    throw new Error("Facebook VOD source url is invalid");
  }

  const response = await fetch(normalizedUrl, {
    redirect: "follow",
    headers: {
      Accept: "video/*,*/*",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Facebook VOD download failed: ${response.status} ${response.statusText}`
    );
  }

  if (!response.body) {
    throw new Error("Facebook VOD download returned an empty body");
  }

  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(targetPath, { flags: "w" })
  );

  return {
    contentLength: toPositiveNumber(response.headers.get("content-length")),
    contentType: asTrimmed(response.headers.get("content-type")) || null,
  };
}

export async function downloadFacebookVodWithYtDlp({
  videoUrl,
  targetPath,
  timeoutMs = YT_DLP_TIMEOUT_MS,
}) {
  const normalizedUrl = asTrimmed(videoUrl);
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    throw new Error("Facebook VOD url is invalid");
  }

  const outputTemplate = path.join(
    path.dirname(targetPath),
    `${path.basename(targetPath, path.extname(targetPath))}.%(ext)s`
  );
  const args = [
    "--no-playlist",
    "--no-part",
    "--newline",
    "--no-progress",
    "--retries",
    "3",
    "--fragment-retries",
    "3",
    "--socket-timeout",
    "30",
    "--format",
    "bestvideo*+bestaudio/best",
    "--merge-output-format",
    "mp4",
    "--output",
    outputTemplate,
    ...getYtDlpCookieArgs(),
    normalizedUrl,
  ];

  try {
    await runYtDlp(args, { timeoutMs });
  } catch (error) {
    throw createYtDlpError(
      error?.message || "yt-dlp download failed",
      classifyYtDlpFailure(error),
      {
        stderr: error?.stderr || "",
        stdout: error?.stdout || "",
      }
    );
  }

  const finalPath = await findDownloadedVideoPath(targetPath);
  if (!finalPath) {
    throw createYtDlpError(
      "yt-dlp finished but no media file was found",
      "YTDLP_OUTPUT_MISSING"
    );
  }

  const stat = await fs.promises.stat(finalPath);
  if (finalPath !== targetPath) {
    await fs.promises.rename(finalPath, targetPath);
  }

  return {
    filePath: targetPath,
    sizeBytes: stat.size,
    contentType: null,
  };
}
