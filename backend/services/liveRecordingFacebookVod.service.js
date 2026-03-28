import fs from "node:fs";
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

export async function resolveFacebookVodDownloadInfo(match) {
  const facebook = getFacebookLiveIdentifiers(match);
  if (!facebook.videoId) {
    throw new Error("Facebook live video id is missing");
  }

  let pageAccessToken = "";
  let tokenError = null;

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

  if (!pageAccessToken) {
    throw new Error(
      tokenError?.message || "Facebook page access token is unavailable"
    );
  }

  const payload = await fbGetLiveVideo({
    liveVideoId: facebook.videoId,
    pageAccessToken,
    fields: FACEBOOK_VOD_FIELDS,
  });

  return {
    ready: Boolean(pickFacebookVodSourceUrl(payload)),
    sourceUrl: pickFacebookVodSourceUrl(payload),
    durationSeconds: toPositiveNumber(payload?.length),
    title: asTrimmed(payload?.title) || null,
    status: asTrimmed(payload?.status) || null,
    permalinkUrl: asTrimmed(payload?.permalink_url) || facebook.watchUrl || null,
    pageAccessToken,
    pageId: facebook.pageId,
    videoId: facebook.videoId,
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
