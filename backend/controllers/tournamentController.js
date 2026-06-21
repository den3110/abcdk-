import asyncHandler from "express-async-handler";
import Tournament from "../models/tournamentModel.js";
import mongoose from "mongoose";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import Bracket from "../models/bracketModel.js";
import Match from "../models/matchModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import Registration from "../models/registrationModel.js";
import DrawSession from "../models/drawSessionModel.js";
import Court from "../models/courtModel.js";
import { sleep } from "../utils/sleep.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import { ensureTournamentCardImageUrl } from "../utils/tournamentImageVariant.js";
import { normalizeMatchDisplayShape } from "../socket/liveHandlers.js";
import {
  attachPublicStreamsToMatch,
  getLatestRecordingsByMatchIds,
} from "../services/publicStreams.service.js";
import {
  buildTeamRoster,
  buildTeamStandings,
} from "../services/teamTournament.service.js";
import { buildMatchCodePayload } from "../utils/matchDisplayCode.js";
import {
  attachResolvedSideNamesToMatches as attachBackendResolvedSideNamesToMatches,
} from "../utils/matchSideDisplay.js";

const isId = (id) => mongoose.Types.ObjectId.isValid(id);
const POSTER_BASE_W = 960;
const POSTER_BASE_H = 1280;
const MATCH_PAIR_PLAYER_SELECT = "fullName name shortName nickname nickName user";
const MATCH_PAIR_USER_SELECT = "fullName name nickname nickName";
const MATCH_PAIR_POPULATE = (path) => ({
  path,
  select: "player1 player2 label teamName name",
  populate: [
    {
      path: "player1",
      select: MATCH_PAIR_PLAYER_SELECT,
      populate: { path: "user", select: MATCH_PAIR_USER_SELECT },
    },
    {
      path: "player2",
      select: MATCH_PAIR_PLAYER_SELECT,
      populate: { path: "user", select: MATCH_PAIR_USER_SELECT },
    },
  ],
});

function isAdminLikeUser(user = {}) {
  if (!user) return false;
  if (user.isAdmin === true || user.isSuperUser === true || user.isSuperAdmin === true) {
    return true;
  }
  if (String(user.role || "").trim().toLowerCase() === "admin") return true;
  if (Array.isArray(user.roles)) {
    return user.roles
      .map((role) => String(role || "").trim().toLowerCase())
      .includes("admin");
  }
  return false;
}

async function canBypassPosterPayment(req, tourId, tour = {}) {
  if (isAdminLikeUser(req.user)) return true;
  const userId = String(req.user?._id || req.user?.id || "");
  if (!userId) return false;
  if (tour?.createdBy && String(tour.createdBy) === userId) return true;
  const manager = await TournamentManager.exists({
    tournament: tourId,
    user: userId,
  });
  return Boolean(manager);
}

const docId = (value) => {
  const raw = value?._id || value?.id || value || "";
  return raw ? String(raw) : "";
};

const seedTypeKey = (seed) =>
  String(seed?.type || "")
    .trim()
    .toLowerCase();

const isByeSeedForMatchList = (seed) =>
  seedTypeKey(seed) === "bye" || /\bBYE\b/i.test(String(seed?.label || ""));

const isMatchWinnerSeedType = (type) =>
  type === "stagematchwinner" || type === "matchwinner";

const isMatchLoserSeedType = (type) =>
  type === "stagematchloser" || type === "matchloser";

const hasResolvedPairForMatchList = (pair) =>
  Boolean(
    pair &&
      (pair.player1 ||
        pair.player2 ||
        (Array.isArray(pair.players) && pair.players.length > 0) ||
        String(pair.displayName || "").trim() ||
        String(pair.teamName || "").trim() ||
        String(pair.label || "").trim() ||
        String(pair.name || "").trim())
  );

const parseMatchListCode = (value) => {
  const match = String(value || "")
    .trim()
    .match(/\b(?:[WL]\s*-\s*)?(V\d+(?:-(?:B[A-Z0-9]+|NT))?-T\d+)\b/i);
  return match?.[1] ? match[1].toUpperCase().replace(/\s+/g, "") : "";
};

const hydrateResolvedPairsInMatchList = async (
  matches,
  { baseByBracketId, matchesByBracketId } = {}
) => {
  if (!Array.isArray(matches) || !matches.length) return matches;

  const byId = new Map();
  const byCode = new Map();
  const codeOf = (match) => {
    const direct =
      parseMatchListCode(match?.displayCode) ||
      parseMatchListCode(match?.codeResolved) ||
      parseMatchListCode(match?.code) ||
      parseMatchListCode(match?.matchCode);
    const built = String(
      buildMatchCodePayload(match, {
        baseByBracketId,
        matchesByBracketId,
      })?.displayCode || ""
    )
      .trim()
      .toUpperCase();
    const fallback = (() => {
      const bracketId = docId(match?.bracket);
      const base = baseByBracketId?.get?.(bracketId) || 0;
      const round = Number(match?.round || 1);
      const order = Number(match?.order || 0) + 1;
      if (!Number.isFinite(round) || !Number.isFinite(order)) return "";
      return `V${base + round}-T${order}`;
    })();
    return built || direct || fallback;
  };

  for (const match of matches) {
    const id = docId(match);
    if (id) byId.set(id, match);
  }
  for (const match of matches) {
    const code = codeOf(match);
    if (code) byCode.set(code, match);
  }

  const sourceFromSeed = (ownerMatch, seed) => {
    const directIds = [
      seed?.ref?.matchId,
      seed?.ref?.match,
      seed?.matchId,
      seed?.match,
    ].map(docId);
    for (const id of directIds) {
      if (id && byId.has(id) && id !== docId(ownerMatch)) return byId.get(id);
    }

    const labelCode = parseMatchListCode(
      seed?.label || seed?.displayName || seed?.name || seed?.title
    );
    if (labelCode && byCode.has(labelCode)) return byCode.get(labelCode);

    return null;
  };

  const resolveSidePair = (ownerMatch, side, depth = 0) => {
    if (!ownerMatch || depth > 10) return null;
    const sideKey = side === "B" ? "B" : "A";
    const pair = sideKey === "A" ? ownerMatch.pairA : ownerMatch.pairB;
    const seed = sideKey === "A" ? ownerMatch.seedA : ownerMatch.seedB;
    const seedType = seedTypeKey(seed);

    if (seedType === "registration") return pair || null;
    if (isByeSeedForMatchList(seed)) return null;

    const isWinnerSeed = isMatchWinnerSeedType(seedType);
    const isLoserSeed = isMatchLoserSeedType(seedType);
    if (!isWinnerSeed && !isLoserSeed) return pair || null;

    const previous = sideKey === "A" ? ownerMatch.previousA : ownerMatch.previousB;
    const previousId = docId(previous);
    let sourceMatch = previousId ? byId.get(previousId) : null;
    if (!sourceMatch) sourceMatch = sourceFromSeed(ownerMatch, seed);
    if (!sourceMatch) return pair || null;

    const sourceByeA = isByeSeedForMatchList(sourceMatch.seedA);
    const sourceByeB = isByeSeedForMatchList(sourceMatch.seedB);
    if (sourceByeA || sourceByeB) {
      if (isLoserSeed || (sourceByeA && sourceByeB)) return null;
      const carriedSide = sourceByeA ? "B" : "A";
      const carriedPair =
        carriedSide === "A" ? sourceMatch.pairA : sourceMatch.pairB;
      if (hasResolvedPairForMatchList(carriedPair)) return carriedPair;
      return resolveSidePair(sourceMatch, carriedSide, depth + 1);
    }

    const winnerSide =
      sourceMatch.winner === "A" || sourceMatch.winner === "B"
        ? sourceMatch.winner
        : "";
    if (!winnerSide) return pair || null;

    const sourceSide = isLoserSeed
      ? winnerSide === "A"
        ? "B"
        : "A"
      : winnerSide;
    const sourcePair = sourceSide === "A" ? sourceMatch.pairA : sourceMatch.pairB;
    if (hasResolvedPairForMatchList(sourcePair)) return sourcePair;
    return resolveSidePair(sourceMatch, sourceSide, depth + 1);
  };

  const ops = [];
  for (const match of matches) {
    const patch = {};
    for (const side of ["A", "B"]) {
      const field = side === "A" ? "pairA" : "pairB";
      const resolvedPair = resolveSidePair(match, side);
      const resolvedId = docId(resolvedPair);
      if (!resolvedId || !hasResolvedPairForMatchList(resolvedPair)) continue;
      if (docId(match[field]) !== resolvedId) patch[field] = resolvedId;
      match[field] = resolvedPair;
    }
    if (Object.keys(patch).length) {
      ops.push({
        updateOne: {
          filter: { _id: match._id },
          update: { $set: patch, $inc: { liveVersion: 1, version: 1 } },
        },
      });
    }
  }

  if (ops.length) await Match.bulkWrite(ops, { ordered: false }).catch(() => {});
  return matches;
};

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function asDisplayName(player = {}, tour = {}) {
  const mode = String(tour?.nameDisplayMode || "").toLowerCase();
  const user = player?.user && typeof player.user === "object" ? player.user : {};
  if (mode === "fullname") {
    return (
      player.fullName ||
      user.fullName ||
      user.name ||
      player.nickName ||
      player.nickname ||
      user.nickName ||
      user.nickname ||
      "VĐV"
    );
  }
  return (
    player.nickName ||
    player.nickname ||
    user.nickName ||
    user.nickname ||
    player.fullName ||
    user.fullName ||
    user.name ||
    "VĐV"
  );
}

function posterAvatarValue(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "object") return "";
  return String(
    value.url ||
      value.secureUrl ||
      value.secure_url ||
      value.src ||
      value.path ||
      value.optimizedFor ||
      "",
  ).trim();
}

function isPosterPlaceholderAvatar(src = "") {
  const value = String(src || "").toLowerCase();
  return (
    !value ||
    value.includes("dummyimage.com") ||
    value.includes("default-avatar") ||
    value.includes("placeholder") ||
    value.includes("text=?")
  );
}

function resolvePosterAvatarSource(player = {}) {
  const user = player?.user && typeof player.user === "object" ? player.user : {};
  const candidates = [
    { source: "user.avatar", value: posterAvatarValue(user?.avatar) },
    {
      source: "user.avatarOptimization.optimizedFor",
      value: posterAvatarValue(user?.avatarOptimization?.optimizedFor),
    },
    { source: "user.avatarUrl", value: posterAvatarValue(user?.avatarUrl) },
    { source: "user.image", value: posterAvatarValue(user?.image) },
    {
      source: "registration.player.avatar",
      value: posterAvatarValue(player?.avatar),
    },
    {
      source: "registration.player.avatarUrl",
      value: posterAvatarValue(player?.avatarUrl),
    },
    {
      source: "registration.player.image",
      value: posterAvatarValue(player?.image),
    },
  ].filter((item) => item.value);

  const selected =
    candidates.find((item) => !isPosterPlaceholderAvatar(item.value)) ||
    candidates[0] ||
    null;

  return {
    source: selected?.source || "",
    url: selected?.value || "",
    isPlaceholder: selected ? isPosterPlaceholderAvatar(selected.value) : true,
    candidates,
  };
}

function resolveLocalImagePath(src = "") {
  const clean = String(src || "").split("?")[0].replace(/\\/g, "/").trim();
  if (!clean) return null;
  if (/^https?:\/\//i.test(clean)) {
    try {
      const url = new URL(clean);
      const pathname = decodeURIComponent(url.pathname || "");
      if (pathname.startsWith("/uploads/")) {
        return path.join(process.cwd(), pathname.replace(/^\/+/, ""));
      }
    } catch {}
    return null;
  }
  if (/^[a-zA-Z]:\//.test(clean)) {
    return path.normalize(clean);
  }
  if (clean.startsWith("/")) {
    return path.join(process.cwd(), clean.replace(/^\/+/, ""));
  }
  return path.join(process.cwd(), clean.replace(/^\/+/, ""));
}

async function readImageBuffer(req, src = "") {
  const raw = String(src || "").trim();
  if (!raw) throw new Error("Missing image source");

  const localPath = resolveLocalImagePath(raw);
  if (localPath) {
    try {
      return await fs.readFile(localPath);
    } catch {}
  }

  const origin = `${req.protocol}://${req.get("host")}`;
  const url = /^https?:\/\//i.test(raw) ? raw : new URL(raw, origin).toString();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Cannot load image: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

const POSTER_USER_SELECT =
  "name fullName nickname nickName avatar avatarUrl image avatarOptimization";

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scaleCoord(value, outputSize, baseSize, fallback = 0) {
  const n = numOr(value, fallback);
  if (n >= 0 && n <= 1) return Math.round(n * outputSize);
  return Math.round(n * (outputSize / baseSize));
}

function scaleFont(value, outputHeight, baseHeight, fallback) {
  const n = numOr(value, fallback);
  if (n > 0 && n <= 1) return Math.round(n * outputHeight);
  return Math.round(n * (outputHeight / baseHeight));
}

function resolveRadius(radius, width, height, fallbackRatio = 0.08) {
  if (String(radius || "").toLowerCase() === "circle") {
    return Math.round(Math.min(width, height) / 2);
  }
  const n = Number(radius);
  if (Number.isFinite(n)) {
    if (n >= 0 && n <= 1) return Math.round(n * Math.min(width, height));
    return Math.round(n);
  }
  return Math.round(width * fallbackRatio);
}

function clampInt(value, min, max, fallback = min) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function getRectOverlapArea(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function getPosterPixel(data, offset) {
  const alpha = data[offset + 3];
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return {
    r,
    g,
    b,
    alpha,
    max,
    min,
    luma: 0.2126 * r + 0.7152 * g + 0.0722 * b,
  };
}

function colorDistance(a, b) {
  return Math.sqrt(
    (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2,
  );
}

function addPosterColorCandidate(candidates, color, threshold = 44) {
  if (!color || color.alpha < 180) return;
  if (
    candidates.some(
      (candidate) => colorDistance(candidate, color) <= candidate.threshold,
    )
  ) {
    return;
  }
  candidates.push({
    r: color.r,
    g: color.g,
    b: color.b,
    threshold,
  });
}

function averagePosterColorAt(data, canvasWidth, canvasHeight, x, y, radius = 3) {
  const left = clampInt(x - radius, 0, canvasWidth - 1, 0);
  const top = clampInt(y - radius, 0, canvasHeight - 1, 0);
  const right = clampInt(x + radius + 1, left + 1, canvasWidth, canvasWidth);
  const bottom = clampInt(y + radius + 1, top + 1, canvasHeight, canvasHeight);
  let count = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let yy = top; yy < bottom; yy += 1) {
    for (let xx = left; xx < right; xx += 1) {
      const pixel = getPosterPixel(data, (yy * canvasWidth + xx) * 4);
      if (pixel.alpha < 180) continue;
      r += pixel.r;
      g += pixel.g;
      b += pixel.b;
      count += 1;
    }
  }
  if (!count) return null;
  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);
  return {
    r,
    g,
    b,
    alpha: 255,
    max: Math.max(r, g, b),
    min: Math.min(r, g, b),
  };
}

function collectPosterPlaceholderCandidates(
  data,
  canvasWidth,
  canvasHeight,
  slotBox,
) {
  const candidates = [];
  const points = [
    [0.5, 0.5],
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ];
  for (const [px, py] of points) {
    const color = averagePosterColorAt(
      data,
      canvasWidth,
      canvasHeight,
      slotBox.left + slotBox.width * px,
      slotBox.top + slotBox.height * py,
    );
    addPosterColorCandidate(candidates, color, 48);
  }

  const buckets = new Map();
  const step = Math.max(2, Math.floor(Math.min(slotBox.width, slotBox.height) / 44));
  const left = clampInt(slotBox.left + slotBox.width * 0.12, 0, canvasWidth - 1, 0);
  const top = clampInt(slotBox.top + slotBox.height * 0.12, 0, canvasHeight - 1, 0);
  const right = clampInt(
    slotBox.left + slotBox.width * 0.88,
    left + 1,
    canvasWidth,
    canvasWidth,
  );
  const bottom = clampInt(
    slotBox.top + slotBox.height * 0.88,
    top + 1,
    canvasHeight,
    canvasHeight,
  );
  let total = 0;
  for (let y = top; y < bottom; y += step) {
    for (let x = left; x < right; x += step) {
      const pixel = getPosterPixel(data, (y * canvasWidth + x) * 4);
      if (pixel.alpha < 180) continue;
      const key = `${pixel.r >> 4}:${pixel.g >> 4}:${pixel.b >> 4}`;
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += pixel.r;
      bucket.g += pixel.g;
      bucket.b += pixel.b;
      buckets.set(key, bucket);
      total += 1;
    }
  }
  Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .forEach((bucket) => {
      if (!total || bucket.count / total < 0.08) return;
      const color = {
        r: Math.round(bucket.r / bucket.count),
        g: Math.round(bucket.g / bucket.count),
        b: Math.round(bucket.b / bucket.count),
        alpha: 255,
      };
      addPosterColorCandidate(candidates, color, 42);
    });

  return candidates;
}

function isPosterPhotoPlaceholderPixel(data, offset, colorCandidates = []) {
  const pixel = getPosterPixel(data, offset);
  if (pixel.alpha < 180) return false;
  if (pixel.r >= 218 && pixel.g >= 218 && pixel.b >= 218 && pixel.max - pixel.min <= 42) {
    return true;
  }
  if (pixel.max - pixel.min <= 36 && pixel.max >= 176) {
    return true;
  }
  return colorCandidates.some(
    (candidate) => colorDistance(pixel, candidate) <= candidate.threshold,
  );
}

async function buildAvatarPlaceholderMask(
  templateRaw,
  canvasWidth,
  canvasHeight,
  avatar = {},
  options = {},
) {
  const slotLeft = clampInt(avatar.left, 0, canvasWidth - 1, 0);
  const slotTop = clampInt(avatar.top, 0, canvasHeight - 1, 0);
  const slotWidth = clampInt(avatar.width, 1, canvasWidth - slotLeft, 1);
  const slotHeight = clampInt(avatar.height, 1, canvasHeight - slotTop, 1);
  const slotBox = {
    left: slotLeft,
    top: slotTop,
    width: slotWidth,
    height: slotHeight,
  };
  const colorCandidates = collectPosterPlaceholderCandidates(
    templateRaw,
    canvasWidth,
    canvasHeight,
    slotBox,
  );
  const padX = Math.max(18, Math.round(slotWidth * 0.7));
  const padY = Math.max(18, Math.round(slotHeight * 0.7));
  const searchLeft = clampInt(slotLeft - padX, 0, canvasWidth - 1, 0);
  const searchTop = clampInt(slotTop - padY, 0, canvasHeight - 1, 0);
  const searchRight = clampInt(
    slotLeft + slotWidth + padX,
    searchLeft + 1,
    canvasWidth,
    canvasWidth,
  );
  const searchBottom = clampInt(
    slotTop + slotHeight + padY,
    searchTop + 1,
    canvasHeight,
    canvasHeight,
  );
  const searchWidth = searchRight - searchLeft;
  const searchHeight = searchBottom - searchTop;
  const visited = new Uint8Array(searchWidth * searchHeight);
  const centerX = slotLeft + slotWidth / 2;
  const centerY = slotTop + slotHeight / 2;
  let best = null;

  const isPlaceholderAt = (localX, localY) => {
    const x = searchLeft + localX;
    const y = searchTop + localY;
    return isPosterPhotoPlaceholderPixel(
      templateRaw,
      (y * canvasWidth + x) * 4,
      colorCandidates,
    );
  };

  for (let y = 0; y < searchHeight; y += 1) {
    for (let x = 0; x < searchWidth; x += 1) {
      const startIndex = y * searchWidth + x;
      if (visited[startIndex] || !isPlaceholderAt(x, y)) continue;

      const stack = [startIndex];
      const pixels = [];
      visited[startIndex] = 1;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      while (stack.length) {
        const index = stack.pop();
        pixels.push(index);
        const px = index % searchWidth;
        const py = Math.floor(index / searchWidth);
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        const neighbors = [
          index - 1,
          index + 1,
          index - searchWidth,
          index + searchWidth,
        ];
        for (const next of neighbors) {
          if (next < 0 || next >= visited.length || visited[next]) continue;
          const nx = next % searchWidth;
          const ny = Math.floor(next / searchWidth);
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
          if (!isPlaceholderAt(nx, ny)) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }

      const box = {
        left: searchLeft + minX,
        top: searchTop + minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
      if (box.width > slotWidth * 2.8 || box.height > slotHeight * 2.8) {
        continue;
      }
      const overlap = getRectOverlapArea(box, slotBox);
      const containsCenter =
        centerX >= box.left &&
        centerX <= box.left + box.width &&
        centerY >= box.top &&
        centerY <= box.top + box.height;
      if (!overlap && !containsCenter) continue;

      const area = pixels.length;
      const score = area + overlap * 8 + (containsCenter ? area * 3 : 0);
      if (!best || score > best.score) {
        best = { score, area, box, pixels, minX, minY, maxX, maxY };
      }
    }
  }

  if (!best || best.area < Math.max(slotWidth * slotHeight * 0.35, 1200)) {
    return null;
  }

  const { box } = best;
  const defaultInset = clampInt(Math.min(box.width, box.height) * 0.025, 4, 16, 8);
  const requestedInset = Object.prototype.hasOwnProperty.call(options, "inset")
    ? options.inset
    : defaultInset;
  const inset = clampInt(
    requestedInset,
    0,
    Math.floor(Math.min(box.width, box.height) * 0.12),
    defaultInset,
  );
  const mask = Buffer.alloc(box.width * box.height * 4);
  for (const index of best.pixels) {
    const localX = index % searchWidth;
    const localY = Math.floor(index / searchWidth);
    const globalX = searchLeft + localX;
    const globalY = searchTop + localY;
    if (
      globalX < box.left + inset ||
      globalX >= box.left + box.width - inset ||
      globalY < box.top + inset ||
      globalY >= box.top + box.height - inset
    ) {
      continue;
    }
    const maskX = globalX - box.left;
    const maskY = globalY - box.top;
    const offset = (maskY * box.width + maskX) * 4;
    mask[offset] = 255;
    mask[offset + 1] = 255;
    mask[offset + 2] = 255;
    mask[offset + 3] = 255;
  }

  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    radius: 0,
    mask: await sharp(mask, {
      raw: { width: box.width, height: box.height, channels: 4 },
    })
      .blur(0.6)
      .png()
      .toBuffer(),
  };
}

function findPosterPhotoPlaceholderRegions(templateRaw, canvasWidth, canvasHeight) {
  if (!templateRaw || !canvasWidth || !canvasHeight) return [];

  const visited = new Uint8Array(canvasWidth * canvasHeight);
  const candidates = [];
  const minTop = canvasHeight * 0.24;
  const maxTop = canvasHeight * 0.78;
  const minWidth = canvasWidth * 0.12;
  const maxWidth = canvasWidth * 0.42;
  const minHeight = canvasHeight * 0.08;
  const maxHeight = canvasHeight * 0.34;

  const isPlaceholderAt = (x, y) =>
    isPosterPhotoPlaceholderPixel(templateRaw, (y * canvasWidth + x) * 4, []);

  for (let y = 0; y < canvasHeight; y += 1) {
    for (let x = 0; x < canvasWidth; x += 1) {
      const startIndex = y * canvasWidth + x;
      if (visited[startIndex] || !isPlaceholderAt(x, y)) continue;

      const stack = [startIndex];
      visited[startIndex] = 1;
      let area = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      while (stack.length) {
        const index = stack.pop();
        const px = index % canvasWidth;
        const py = Math.floor(index / canvasWidth);
        area += 1;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        const neighbors = [
          index - 1,
          index + 1,
          index - canvasWidth,
          index + canvasWidth,
        ];
        for (const next of neighbors) {
          if (next < 0 || next >= visited.length || visited[next]) continue;
          const nx = next % canvasWidth;
          const ny = Math.floor(next / canvasWidth);
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
          if (!isPlaceholderAt(nx, ny)) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }

      const box = {
        left: minX,
        top: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
      const fillRatio = area / Math.max(1, box.width * box.height);
      if (
        box.top < minTop ||
        box.top > maxTop ||
        box.width < minWidth ||
        box.width > maxWidth ||
        box.height < minHeight ||
        box.height > maxHeight ||
        fillRatio < 0.45
      ) {
        continue;
      }

      const inset = clampInt(Math.min(box.width, box.height) * 0.035, 4, 16, 8);
      const inner = {
        left: box.left + inset,
        top: box.top + inset,
        width: Math.max(1, box.width - inset * 2),
        height: Math.max(1, box.height - inset * 2),
      };
      candidates.push({
        ...inner,
        radius: Math.round(Math.min(inner.width, inner.height) * 0.07),
        score: area + box.width * box.height * fillRatio,
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .sort((a, b) => a.left - b.left);
}

async function readPosterTemplateRaw(baseBuffer, width, height) {
  try {
    return await sharp(baseBuffer)
      .resize(width, height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
}

async function refinePosterAvatarSlots(baseBuffer, slots, width, height, raw) {
  if (!Array.isArray(slots) || !slots.length) return slots;
  const templateRaw = raw || (await readPosterTemplateRaw(baseBuffer, width, height));
  if (!templateRaw) return slots;
  const detectedRegions = findPosterPhotoPlaceholderRegions(
    templateRaw,
    width,
    height,
  );
  if (detectedRegions.length >= slots.length) {
    const selected =
      slots.length <= 1
        ? [
            detectedRegions.reduce((best, item) => {
              const bestCenter = Math.abs(best.left + best.width / 2 - width / 2);
              const itemCenter = Math.abs(item.left + item.width / 2 - width / 2);
              return itemCenter < bestCenter ? item : best;
            }, detectedRegions[0]),
          ]
        : detectedRegions.slice(0, slots.length);

    return slots.map((slot, index) => ({
      ...slot,
      avatar: {
        ...slot.avatar,
        ...selected[index],
      },
    }));
  }

  return Promise.all(
    slots.map(async (slot) => {
      const refined = await buildAvatarPlaceholderMask(
        templateRaw,
        width,
        height,
        slot?.avatar,
      ).catch(() => null);
      if (!refined) return slot;
      return {
        ...slot,
        avatar: {
          ...slot.avatar,
          ...refined,
        },
      };
    }),
  );
}

async function applyPosterAiTemplateMasks(slots, width, height, templateRaw) {
  if (!templateRaw || !Array.isArray(slots) || !slots.length) return slots;

  return Promise.all(
    slots.map(async (slot) => {
      const safeInset = numOr(slot?.avatar?.safeInset, 0);
      const refined = await buildAvatarPlaceholderMask(
        templateRaw,
        width,
        height,
        slot?.avatar,
        { inset: safeInset },
      ).catch(() => null);
      if (!refined) return slot;

      return {
        ...slot,
        avatar: {
          ...slot.avatar,
          ...refined,
          safeInset: 0,
        },
      };
    }),
  );
}

function isPosterNamePanelPixel(data, offset) {
  const pixel = getPosterPixel(data, offset);
  return pixel.alpha >= 180 && pixel.luma <= 82;
}

function findPosterNamePanel(templateRaw, canvasWidth, canvasHeight, slot = {}) {
  const avatar = slot.avatar || {};
  const name = slot.name || {};
  const avatarBottom = avatar.top + avatar.height;
  const centerX = numOr(name.cx, avatar.left + avatar.width / 2);
  const halfWidth = Math.max(
    numOr(name.width, avatar.width * 1.4) * 0.75,
    avatar.width * 1.05,
  );
  const searchLeft = clampInt(centerX - halfWidth, 0, canvasWidth - 1, 0);
  const searchRight = clampInt(centerX + halfWidth, searchLeft + 1, canvasWidth, canvasWidth);
  const searchTop = clampInt(
    avatarBottom + Math.max(6, avatar.height * 0.05),
    0,
    canvasHeight - 1,
    0,
  );
  const searchBottom = clampInt(
    avatarBottom + Math.max(160, avatar.height * 0.72),
    searchTop + 1,
    canvasHeight,
    canvasHeight,
  );
  const searchWidth = searchRight - searchLeft;
  const searchHeight = searchBottom - searchTop;
  const visited = new Uint8Array(searchWidth * searchHeight);
  const candidates = [];

  const isDarkAt = (localX, localY) => {
    const x = searchLeft + localX;
    const y = searchTop + localY;
    return isPosterNamePanelPixel(templateRaw, (y * canvasWidth + x) * 4);
  };

  for (let y = 0; y < searchHeight; y += 1) {
    for (let x = 0; x < searchWidth; x += 1) {
      const startIndex = y * searchWidth + x;
      if (visited[startIndex] || !isDarkAt(x, y)) continue;

      const stack = [startIndex];
      visited[startIndex] = 1;
      let area = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;

      while (stack.length) {
        const index = stack.pop();
        const px = index % searchWidth;
        const py = Math.floor(index / searchWidth);
        area += 1;
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);

        const neighbors = [
          index - 1,
          index + 1,
          index - searchWidth,
          index + searchWidth,
        ];
        for (const next of neighbors) {
          if (next < 0 || next >= visited.length || visited[next]) continue;
          const nx = next % searchWidth;
          const ny = Math.floor(next / searchWidth);
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
          if (!isDarkAt(nx, ny)) continue;
          visited[next] = 1;
          stack.push(next);
        }
      }

      const box = {
        left: searchLeft + minX,
        top: searchTop + minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      };
      const touchesSearchEdge =
        minX <= 1 ||
        minY <= 1 ||
        maxX >= searchWidth - 2 ||
        maxY >= searchHeight - 2;
      const boxCenterX = box.left + box.width / 2;
      const boxCenterY = box.top + box.height / 2;
      const minPanelWidth = Math.max(avatar.width * 1.04, numOr(name.width, avatar.width) * 0.55);
      const minPanelHeight = Math.max(26, avatar.height * 0.11);
      const maxPanelHeight = Math.max(130, avatar.height * 0.5);
      const belowRoleLabel = boxCenterY >= avatarBottom + avatar.height * 0.18;
      const centered = Math.abs(boxCenterX - centerX) <= Math.max(avatar.width * 0.35, 80);

      if (
        touchesSearchEdge ||
        !belowRoleLabel ||
        !centered ||
        box.width < minPanelWidth ||
        box.height < minPanelHeight ||
        box.height > maxPanelHeight ||
        area < minPanelWidth * minPanelHeight * 0.35
      ) {
        continue;
      }

      candidates.push({
        box,
        area,
        score: area + box.width * box.height + boxCenterY,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.box || null;
}

function refinePosterNameSlots(slots, width, height, templateRaw) {
  if (!templateRaw || !Array.isArray(slots) || !slots.length) return slots;

  return slots.map((slot) => {
    const panel = findPosterNamePanel(templateRaw, width, height, slot);
    if (panel) {
      return {
        ...slot,
        name: {
          ...slot.name,
          cx: panel.left + panel.width / 2,
          y: panel.top + panel.height / 2,
          width: Math.max(1, Math.round(panel.width * 0.82)),
          erase: {
            left: panel.left + panel.width * 0.06,
            top: panel.top + panel.height * 0.12,
            width: panel.width * 0.88,
            height: panel.height * 0.76,
          },
        },
      };
    }

    return slot;
  });
}

async function buildPosterAvatarClipMask(width, height, radius, clipPath, safeInset = 0) {
  const inset = clampInt(safeInset, 0, Math.min(12, width, height), 0);
  const finalizeMask = async (mask) => {
    if (!inset) return mask;
    return sharp(mask).ensureAlpha().erode(inset).png().toBuffer();
  };

  if (
    String(clipPath?.type || "").toLowerCase() === "polygon" &&
    Array.isArray(clipPath.points) &&
    clipPath.points.length >= 3
  ) {
    const points = clipPath.points
      .map((point) => {
        const x = clampInt(point?.x, 0, width, 0);
        const y = clampInt(point?.y, 0, height, 0);
        return `${x},${y}`;
      })
      .join(" ");
    if (points) {
      return finalizeMask(Buffer.from(`
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
          <polygon points="${points}" fill="#fff"/>
        </svg>
      `));
    }
  }

  const rx = resolveRadius(radius, width, height);
  return finalizeMask(Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${width}" height="${height}" rx="${rx}" ry="${rx}" fill="#fff"/>
    </svg>
  `));
}

async function makeAvatarLayer(
  req,
  player,
  width,
  height,
  radius,
  maskInput,
  clipPath,
  safeInset,
) {
  const { url: src } = resolvePosterAvatarSource(player);
  let input = null;
  try {
    input = src ? await readImageBuffer(req, src) : null;
  } catch {
    input = null;
  }

  if (!input) {
    const label = escapeXml(
      asDisplayName(player).slice(0, 1).toUpperCase() || "?",
    );
    input = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#e5e7eb"/>
        <text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle"
          font-family="Arial, sans-serif" font-size="${Math.round(width * 0.36)}"
          font-weight="800" fill="#64748b">${label}</text>
      </svg>
    `);
  }

  const mask =
    maskInput ||
    (await buildPosterAvatarClipMask(width, height, radius, clipPath, safeInset));

  const renderWithMask = (maskBuffer) =>
    sharp(input)
      .resize(width, height, { fit: "cover", position: "center" })
      .composite([{ input: maskBuffer, blend: "dest-in" }])
      .png()
      .toBuffer();

  const output = await renderWithMask(mask);
  if (!maskInput) return output;

  const visibleEnough = await hasVisiblePosterAlpha(output);
  if (visibleEnough) return output;

  const fallbackMask = await buildPosterAvatarClipMask(width, height, radius, null, 0);
  return renderWithMask(fallbackMask);
}

async function hasVisiblePosterAlpha(buffer, minRatio = 0.12) {
  try {
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const total = Math.max(1, Number(info?.width || 0) * Number(info?.height || 0));
    let visible = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 24) visible += 1;
    }
    return visible / total >= minRatio;
  } catch {
    return true;
  }
}

const DEFAULT_POSTER_LAYOUT = {
  baseWidth: POSTER_BASE_W,
  baseHeight: POSTER_BASE_H,
  slots: {
    single: [
      {
        avatar: { left: 333, top: 455, width: 294, height: 294 },
        name: { cx: 480, y: 835, width: 390 },
      },
    ],
    double: [
      {
        avatar: { left: 108, top: 455, width: 294, height: 294 },
        name: { cx: 256, y: 835, width: 390 },
      },
      {
        avatar: { left: 558, top: 455, width: 294, height: 294 },
        name: { cx: 704, y: 835, width: 390 },
      },
    ],
  },
  text: {
    color: "#ffffff",
    fontFamily: "Arial, sans-serif",
    fontWeight: 900,
    fontStyle: "italic",
    transform: "uppercase",
    minFontSize: 24,
    maxFontSize: 46,
    charRatio: 0.58,
  },
};
const POSTER_NAME_TEXT_WIDTH_RATIO = 0.88;
const POSTER_NAME_TEXT_MAX_FONT_SCALE = 0.86;
const POSTER_NAME_TEXT_MAX_HEIGHT_RATIO = 0.52;

function getPosterConfig(tour = {}) {
  return tour.registrationPosterConfig &&
    typeof tour.registrationPosterConfig === "object"
    ? tour.registrationPosterConfig
    : {};
}

function isPosterAiLayoutConfig(cfg = {}) {
  const source = String(cfg?.ai?.source || "").toLowerCase();
  return (
    source === "openai_vision" ||
    source.includes("openai") ||
    source === "claude_vision" ||
    source.includes("claude")
  );
}

function hasPosterAvatarClipPathContract(slot = {}) {
  if (!Number.isFinite(Number(slot?.avatar?.safeInset))) return false;
  const clipPath = slot?.avatar?.clipPath;
  if (!clipPath || typeof clipPath !== "object") return false;
  const type = String(clipPath.type || "").toLowerCase();
  if (type === "rounded_rect") return Array.isArray(clipPath.points);
  if (type === "polygon") {
    return (
      Array.isArray(clipPath.points) &&
      clipPath.points.length >= 3 &&
      clipPath.points.every(
        (point) =>
          Number.isFinite(Number(point?.x)) &&
          Number.isFinite(Number(point?.y)),
      )
    );
  }
  return false;
}

function hasPosterNameEraseContract(slot = {}) {
  const textBox = slot?.name?.textBox;
  const erase = slot?.name?.erase;
  const eraseRegions = slot?.name?.eraseRegions;
  return (
    textBox &&
    typeof textBox === "object" &&
    Number.isFinite(Number(textBox.x ?? textBox.left)) &&
    Number.isFinite(Number(textBox.y ?? textBox.top)) &&
    Number.isFinite(Number(textBox.w ?? textBox.width)) &&
    Number.isFinite(Number(textBox.h ?? textBox.height)) &&
    erase &&
    typeof erase === "object" &&
    Number.isFinite(Number(erase.x ?? erase.left)) &&
    Number.isFinite(Number(erase.y ?? erase.top)) &&
    Number.isFinite(Number(erase.w ?? erase.width)) &&
    Number.isFinite(Number(erase.h ?? erase.height)) &&
    Array.isArray(eraseRegions) &&
    eraseRegions.length > 0 &&
    eraseRegions.every(
      (region) =>
        region &&
        typeof region === "object" &&
        Number.isFinite(Number(region.x ?? region.left)) &&
        Number.isFinite(Number(region.y ?? region.top)) &&
        Number.isFinite(Number(region.w ?? region.width)) &&
        Number.isFinite(Number(region.h ?? region.height)),
    )
  );
}

function getRawPosterSlotsForCount(cfg = {}, playersCount = 2) {
  const slots = cfg.slots;
  if (Array.isArray(slots)) return slots;
  if (!slots || typeof slots !== "object") return [];
  return playersCount <= 1
    ? slots.single || slots.singles || slots.one || []
    : slots.double || slots.doubles || slots.two || [];
}

function hasCurrentPosterAiLayoutContract(cfg = {}, playersCount = 2) {
  const layoutVersion = Number(cfg?.ai?.layoutVersion || 0);
  if (layoutVersion < 6) return false;
  const slots = getRawPosterSlotsForCount(cfg, playersCount);
  const expected = Math.max(1, Math.min(Number(playersCount) || 1, 2));
  if (!Array.isArray(slots) || slots.length < expected) return false;
  return slots
    .slice(0, expected)
    .every(
      (slot) =>
        hasPosterAvatarClipPathContract(slot) && hasPosterNameEraseContract(slot),
    );
}

function shouldTrustPosterAiLayout(tour = {}, playersCount = 2) {
  const cfg = getPosterConfig(tour);
  return (
    isPosterAiLayoutConfig(cfg) &&
    hasCurrentPosterAiLayoutContract(cfg, playersCount)
  );
}

function shouldRejectStalePosterAiLayout(tour = {}, playersCount = 2) {
  const cfg = getPosterConfig(tour);
  return (
    isPosterAiLayoutConfig(cfg) &&
    !hasCurrentPosterAiLayoutContract(cfg, playersCount)
  );
}

function getPosterTemplateSource(tour = {}) {
  const cfg = getPosterConfig(tour);
  return cfg.templateUrl || cfg.template;
}

function pickPosterSlots(layout, playersCount) {
  const rawSlots = layout.slots;
  if (Array.isArray(rawSlots)) return rawSlots;
  if (!rawSlots || typeof rawSlots !== "object") {
    return playersCount <= 1
      ? DEFAULT_POSTER_LAYOUT.slots.single
      : DEFAULT_POSTER_LAYOUT.slots.double;
  }

  if (playersCount <= 1) {
    return (
      rawSlots.single ||
      rawSlots.singles ||
      rawSlots.one ||
      DEFAULT_POSTER_LAYOUT.slots.single
    );
  }

  return (
    rawSlots.double ||
    rawSlots.doubles ||
    rawSlots.two ||
    DEFAULT_POSTER_LAYOUT.slots.double
  );
}

function resolvePosterBox(box = {}, width, height, baseWidth, baseHeight) {
  const left = scaleCoord(box.left ?? box.x, width, baseWidth);
  const top = scaleCoord(box.top ?? box.y, height, baseHeight);
  const resolved = {
    left,
    top,
    width: Math.max(1, scaleCoord(box.width ?? box.w, width, baseWidth, 1)),
    height: Math.max(1, scaleCoord(box.height ?? box.h, height, baseHeight, 1)),
    radius: box.radius ?? box.r,
  };
  const safeInset = clampInt(
    scaleCoord(
      box.safeInset ?? box.inset ?? 0,
      Math.min(width, height),
      Math.min(baseWidth, baseHeight),
      0,
    ),
    0,
    Math.floor(Math.min(resolved.width, resolved.height) * 0.2),
    0,
  );
  const clipPath = resolvePosterClipPath(
    box.clipPath,
    width,
    height,
    baseWidth,
    baseHeight,
  );
  if (clipPath.type === "polygon" && clipPath.box) {
    return {
      ...clipPath.box,
      radius: resolved.radius,
      safeInset,
      clipPath: {
        type: "polygon",
        points: clipPath.points,
      },
    };
  }

  const insetBox = {
    left: resolved.left + safeInset,
    top: resolved.top + safeInset,
    width: Math.max(1, resolved.width - safeInset * 2),
    height: Math.max(1, resolved.height - safeInset * 2),
    radius:
      typeof resolved.radius === "number"
        ? Math.max(0, resolved.radius - safeInset)
        : resolved.radius,
    safeInset: 0,
  };

  return {
    ...insetBox,
    clipPath,
  };
}

function resolvePosterClipPath(clipPath, width, height, baseWidth, baseHeight) {
  const type = String(clipPath?.type || "").toLowerCase();
  const rawPoints = Array.isArray(clipPath?.points) ? clipPath.points : [];
  if (type !== "polygon" || rawPoints.length < 3) {
    return { type: "rounded_rect", points: [] };
  }

  const absolutePoints = rawPoints
    .map((point) => {
      return {
        x: clampInt(scaleCoord(point?.x, width, baseWidth), 0, width, 0),
        y: clampInt(scaleCoord(point?.y, height, baseHeight), 0, height, 0),
      };
    })
    .filter((point, index, list) => {
      const prev = list[index - 1];
      return !prev || prev.x !== point.x || prev.y !== point.y;
    });

  if (absolutePoints.length < 3) {
    return { type: "rounded_rect", points: [] };
  }

  const minX = Math.min(...absolutePoints.map((point) => point.x));
  const minY = Math.min(...absolutePoints.map((point) => point.y));
  const maxX = Math.max(...absolutePoints.map((point) => point.x));
  const maxY = Math.max(...absolutePoints.map((point) => point.y));
  const box = {
    left: minX,
    top: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
  if (box.width < 2 || box.height < 2) {
    return { type: "rounded_rect", points: [] };
  }

  const points = absolutePoints.map((point) => ({
    x: point.x - box.left,
    y: point.y - box.top,
  }));

  return { type: "polygon", points: points.slice(0, 32), box };
}

function resolvePosterName(name = {}, width, height, baseWidth, baseHeight) {
  const rawTextBox =
    name.textBox && typeof name.textBox === "object" ? name.textBox : null;
  const rawErase = name.erase && typeof name.erase === "object" ? name.erase : null;
  const rawEraseRegions = Array.isArray(name.eraseRegions)
    ? name.eraseRegions
    : [];
  const scaleEraseBox = (box = {}) => ({
    left: scaleCoord(box.left ?? box.x, width, baseWidth),
    top: scaleCoord(box.top ?? box.y, height, baseHeight),
    width: Math.max(
      1,
      scaleCoord(box.width ?? box.w, width, baseWidth, 1),
    ),
    height: Math.max(
      1,
      scaleCoord(box.height ?? box.h, height, baseHeight, 1),
    ),
  });
  const textBox = rawTextBox ? scaleEraseBox(rawTextBox) : null;
  const fallbackHeight =
    name.height || name.h
      ? Math.max(1, scaleCoord(name.height ?? name.h, height, baseHeight, 1))
      : undefined;
  return {
    cx: textBox
      ? textBox.left + textBox.width / 2
      : scaleCoord(name.cx ?? name.x, width, baseWidth),
    y: textBox
      ? textBox.top + textBox.height / 2
      : scaleCoord(name.y ?? name.top, height, baseHeight),
    width: textBox
      ? textBox.width
      : Math.max(1, scaleCoord(name.width ?? name.w, width, baseWidth, 1)),
    height: textBox ? textBox.height : fallbackHeight,
    textBox: textBox || undefined,
    erase: rawErase
      ? scaleEraseBox(rawErase)
      : undefined,
    eraseRegions: rawEraseRegions
      .filter((box) => box && typeof box === "object")
      .slice(0, 6)
      .map(scaleEraseBox),
    fontSize: name.fontSize,
    minFontSize: name.minFontSize,
    maxFontSize: name.maxFontSize,
    color: name.color,
    fontFamily: name.fontFamily,
    fontWeight: name.fontWeight,
    fontStyle: name.fontStyle,
    transform: name.transform,
    charRatio: name.charRatio,
    stroke: name.stroke,
    strokeWidth: name.strokeWidth,
  };
}

function resolvePosterLayout(tour, playersCount, width, height) {
  const cfg = getPosterConfig(tour);
  const baseWidth = numOr(cfg.baseWidth, DEFAULT_POSTER_LAYOUT.baseWidth);
  const baseHeight = numOr(cfg.baseHeight, DEFAULT_POSTER_LAYOUT.baseHeight);
  const rawSlots = pickPosterSlots(
    {
      ...DEFAULT_POSTER_LAYOUT,
      ...cfg,
      slots: cfg.slots || DEFAULT_POSTER_LAYOUT.slots,
    },
    playersCount,
  );
  const selectedSlots = Array.isArray(rawSlots)
    ? rawSlots
    : playersCount <= 1
      ? DEFAULT_POSTER_LAYOUT.slots.single
      : DEFAULT_POSTER_LAYOUT.slots.double;
  const slots = selectedSlots.map((slot = {}) => ({
    avatar: {
      ...resolvePosterBox(
        slot.avatar || slot.photo,
        width,
        height,
        baseWidth,
        baseHeight,
      ),
    },
    name: {
      ...resolvePosterName(
        slot.name || slot.text,
        width,
        height,
        baseWidth,
        baseHeight,
      ),
    },
  }));

  return {
    baseWidth,
    baseHeight,
    slots,
    text: { ...DEFAULT_POSTER_LAYOUT.text, ...(cfg.text || {}) },
  };
}

function buildPosterPlayerDebug(player = {}, index = 0, tour = {}) {
  const user = player?.user && typeof player.user === "object" ? player.user : {};
  const avatar = resolvePosterAvatarSource(player);
  return {
    slot: index + 1,
    userId: String(user?._id || player?.user || ""),
    name: asDisplayName(player, tour),
    avatarUrl: avatar.url,
    avatarSource: avatar.source,
    avatarIsPlaceholder: avatar.isPlaceholder,
    userAvatar: posterAvatarValue(user?.avatar),
    playerAvatar: posterAvatarValue(player?.avatar),
    candidates: avatar.candidates,
  };
}

function formatPosterName(name, cfg) {
  const mode = String(cfg.transform || "uppercase").toLowerCase();
  if (mode === "none") return name;
  if (mode === "lowercase") return name.toLowerCase();
  return name.toUpperCase();
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b]
    .map((value) => clampInt(value, 0, 255, 0).toString(16).padStart(2, "0"))
    .join("")}`;
}

function samplePosterTextBackground(templateRaw, canvasWidth, canvasHeight, box) {
  if (!templateRaw) return "#071322";
  const left = clampInt(box.left, 0, canvasWidth - 1, 0);
  const top = clampInt(box.top, 0, canvasHeight - 1, 0);
  const right = clampInt(box.left + box.width, left + 1, canvasWidth, canvasWidth);
  const bottom = clampInt(
    box.top + box.height,
    top + 1,
    canvasHeight,
    canvasHeight,
  );
  const samples = [];
  for (let y = top; y < bottom; y += 4) {
    for (let x = left; x < right; x += 4) {
      const offset = (y * canvasWidth + x) * 4;
      if (templateRaw[offset + 3] < 180) continue;
      const r = templateRaw[offset];
      const g = templateRaw[offset + 1];
      const b = templateRaw[offset + 2];
      samples.push({
        r,
        g,
        b,
        luma: 0.2126 * r + 0.7152 * g + 0.0722 * b,
      });
    }
  }
  if (!samples.length) return "#071322";
  samples.sort((a, b) => a.luma - b.luma);
  const picked = samples[Math.floor(samples.length * 0.35)] || samples[0];
  return rgbToHex(picked.r, picked.g, picked.b);
}

function parseHexColor(value) {
  const raw = String(value || "").trim();
  const short = raw.match(/^#([0-9a-f]{3})$/i)?.[1];
  if (short) {
    return {
      r: parseInt(short[0] + short[0], 16),
      g: parseInt(short[1] + short[1], 16),
      b: parseInt(short[2] + short[2], 16),
    };
  }
  const long = raw.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (!long) return null;
  return {
    r: parseInt(long.slice(0, 2), 16),
    g: parseInt(long.slice(2, 4), 16),
    b: parseInt(long.slice(4, 6), 16),
  };
}

function colorLuma(color) {
  return color ? 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b : null;
}

function getReadablePosterTextColor(color, backgroundColor) {
  const textColor = parseHexColor(color);
  const bgColor = parseHexColor(backgroundColor);
  if (!bgColor) return color || "#ffffff";
  const bgLuma = colorLuma(bgColor);
  if (!textColor) return bgLuma < 150 ? "#ffffff" : "#111827";
  const textLuma = colorLuma(textColor);
  if (Math.abs(textLuma - bgLuma) < 95) {
    return bgLuma < 150 ? "#ffffff" : "#111827";
  }
  return color || "#ffffff";
}

function buildPosterTextSvg(width, height, players, slots, tour, layout, templateRaw) {
  const textNodes = players
    .map((player, idx) => {
      const slot = slots[idx];
      if (!slot?.name) return "";
      const textCfg = { ...layout.text, ...(slot.name || {}) };
      const rawName = formatPosterName(asDisplayName(player, tour), textCfg);
      const name = escapeXml(rawName);
      const toBackgroundBox = (box = {}) =>
        Number.isFinite(Number(box.left)) &&
        Number.isFinite(Number(box.top)) &&
        Number.isFinite(Number(box.width)) &&
        Number.isFinite(Number(box.height))
          ? {
              left: Number(box.left),
              top: Number(box.top),
              width: Math.max(1, Number(box.width)),
              height: Math.max(1, Number(box.height)),
            }
          : null;
      const textBox = toBackgroundBox(slot.name.textBox);
      const drawCx = textBox
        ? textBox.left + textBox.width / 2
        : slot.name.cx;
      const drawY = textBox
        ? textBox.top + textBox.height / 2
        : slot.name.y;
      const drawWidth = textBox ? textBox.width : slot.name.width;
      const textFitWidth = Math.max(
        1,
        drawWidth * POSTER_NAME_TEXT_WIDTH_RATIO,
      );
      const minFontSize = scaleFont(
        textCfg.minFontSize,
        height,
        layout.baseHeight,
        DEFAULT_POSTER_LAYOUT.text.minFontSize,
      );
      const rawMaxFontSize = scaleFont(
        textCfg.maxFontSize,
        height,
        layout.baseHeight,
        DEFAULT_POSTER_LAYOUT.text.maxFontSize,
      );
      const maxFontSize = Math.max(
        8,
        Math.floor(
          Math.min(
            rawMaxFontSize * POSTER_NAME_TEXT_MAX_FONT_SCALE,
            textBox
              ? textBox.height * POSTER_NAME_TEXT_MAX_HEIGHT_RATIO
              : rawMaxFontSize,
          ),
        ),
      );
      const effectiveMinFontSize = Math.min(minFontSize, maxFontSize);
      const charRatio = numOr(
        textCfg.charRatio,
        DEFAULT_POSTER_LAYOUT.text.charRatio,
      );
      const size = Math.max(
        effectiveMinFontSize,
        Math.min(
          maxFontSize,
          textCfg.fontSize
            ? scaleFont(textCfg.fontSize, height, layout.baseHeight, maxFontSize)
            : Math.floor(
                textFitWidth / Math.max(8, rawName.length * charRatio),
              ),
        ),
      );
      const estimatedWidth = rawName.length * size * charRatio;
      const fitAttrs =
        estimatedWidth > textFitWidth
          ? `textLength="${Math.max(1, Math.floor(textFitWidth))}" lengthAdjust="spacingAndGlyphs"`
          : "";
      const stroke =
        textCfg.stroke && textCfg.strokeWidth
          ? `stroke="${escapeXml(textCfg.stroke)}" stroke-width="${numOr(
              textCfg.strokeWidth,
              0,
            )}"`
          : "";
      const eraseBox = slot.name.erase || {};
      const explicitNameHeight = Number(slot.name.height ?? slot.name.h);
      const backgroundHeight = Math.max(size * 1.55, maxFontSize * 1.1);
      const backgroundWidth = Math.max(1, drawWidth * 0.94);
      const explicitEraseBox = toBackgroundBox(eraseBox);
      const backgroundBox =
        textBox
          ? textBox
          : explicitEraseBox
            ? explicitEraseBox
          : Number.isFinite(explicitNameHeight) && explicitNameHeight > 0
            ? {
                left: drawCx - drawWidth / 2,
                top: drawY - explicitNameHeight / 2,
                width: drawWidth,
                height: explicitNameHeight,
              }
          : {
              left: drawCx - backgroundWidth / 2,
              top: drawY - backgroundHeight / 2,
              width: backgroundWidth,
              height: backgroundHeight,
            };
      const eraseRegionBoxes = Array.isArray(slot.name.eraseRegions)
        ? slot.name.eraseRegions.map(toBackgroundBox).filter(Boolean)
        : [];
      const seenBoxes = new Set();
      const backgroundBoxes = [
        backgroundBox,
        explicitEraseBox,
        ...eraseRegionBoxes,
      ].filter((box) => {
        if (!box) return false;
        const key = [
          Math.round(box.left),
          Math.round(box.top),
          Math.round(box.width),
          Math.round(box.height),
        ].join(":");
        if (seenBoxes.has(key)) return false;
        seenBoxes.add(key);
        return true;
      });
      const backgroundFills =
        textCfg.backgroundFill === "none"
          ? []
          : backgroundBoxes.map((box) => ({
              box,
              fill:
                textCfg.backgroundFill ||
                samplePosterTextBackground(templateRaw, width, height, box),
            }));
      const backgroundNode = backgroundFills
        .filter(({ fill }) => fill)
        .map(({ box, fill }) => {
          const radius = Math.round(box.height * 0.22);
          return `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}"
            rx="${radius}" ry="${radius}" fill="${escapeXml(fill)}" fill-opacity="1"/>`;
        })
        .join("");
      const primaryBackgroundFill =
        textCfg.backgroundFill === "none"
          ? ""
          : textCfg.backgroundFill ||
            samplePosterTextBackground(templateRaw, width, height, backgroundBox);
      const fillColor = getReadablePosterTextColor(
        textCfg.color,
        primaryBackgroundFill || "#071322",
      );
      return `
        ${backgroundNode}
        <text x="${drawCx}" y="${drawY}" text-anchor="middle"
          dominant-baseline="middle" font-family="${escapeXml(textCfg.fontFamily)}"
          font-size="${size}" font-weight="${escapeXml(textCfg.fontWeight)}"
          font-style="${escapeXml(textCfg.fontStyle)}"
          fill="${escapeXml(fillColor)}" ${stroke} ${fitAttrs}>${name}</text>
      `;
    })
    .join("");

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${textNodes}
    </svg>
  `);
}
const normalizeTournamentPublicUrls = async (req, tournament) => {
  if (!tournament || typeof tournament !== "object") return tournament;

  const overlay =
    tournament.overlay && typeof tournament.overlay === "object"
      ? {
          ...tournament.overlay,
          logoUrl: toPublicUrl(req, tournament.overlay.logoUrl, {
            absolute: false,
          }),
        }
      : tournament.overlay;

  return {
    ...tournament,
    image: await ensureTournamentCardImageUrl(req, tournament.image),
    overlay,
  };
};
const setNoStoreHeaders = (res) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");
};
const ROUND_ELIM_TYPES = new Set([
  "roundElim",
  "roundelim",
  "round_elim",
  "round-elim",
  "po",
  "playoff",
]);
const DEFAULT_MATCH_RULES = {
  bestOf: 1,
  pointsToWin: 11,
  winByTwo: true,
};
const ROUND_ELIM_BYE_SEED = { type: "bye", ref: null, label: "BYE" };

const clampMatchRules = (rule, fallback = DEFAULT_MATCH_RULES) => {
  const source =
    rule && typeof rule === "object" ? rule : fallback && typeof fallback === "object" ? fallback : {};
  const bestOf = [1, 3, 5].includes(Number(source.bestOf))
    ? Number(source.bestOf)
    : Number(fallback?.bestOf || DEFAULT_MATCH_RULES.bestOf);
  const pointsToWin = [11, 15, 21].includes(Number(source.pointsToWin))
    ? Number(source.pointsToWin)
    : Number(fallback?.pointsToWin || DEFAULT_MATCH_RULES.pointsToWin);
  const winByTwo =
    typeof source.winByTwo === "boolean"
      ? source.winByTwo
      : typeof fallback?.winByTwo === "boolean"
        ? fallback.winByTwo
        : DEFAULT_MATCH_RULES.winByTwo;
  const capMode = String(source?.cap?.mode || fallback?.cap?.mode || "none");
  const capPoints = Number.isFinite(Number(source?.cap?.points))
    ? Number(source.cap.points)
    : Number.isFinite(Number(fallback?.cap?.points))
      ? Number(fallback.cap.points)
      : null;

  return {
    bestOf,
    pointsToWin,
    winByTwo,
    cap: { mode: capMode, points: capPoints },
  };
};

const cloneRoundElimSeed = (seed, fallbackSeed = null) => {
  if (!seed || typeof seed !== "object" || !seed.type) {
    if (!fallbackSeed) return null;
    return {
      ...fallbackSeed,
      ref:
        fallbackSeed.ref && typeof fallbackSeed.ref === "object"
          ? { ...fallbackSeed.ref }
          : fallbackSeed.ref ?? null,
    };
  }

  return {
    type: String(seed.type),
    ref:
      seed.ref && typeof seed.ref === "object"
        ? { ...seed.ref }
        : seed.ref ?? null,
    label: String(seed.label || fallbackSeed?.label || ""),
  };
};

const defaultRoundElimRegistrationSeed = (index) => ({
  type: "registration",
  ref: {},
  label: `Đội ${index}`,
});

const roundElimMatchesForRound = (drawSize, roundNum) => {
  const totalTeams = Math.max(0, Number(drawSize || 0));
  const round = Math.max(1, Number(roundNum || 1));
  if (round === 1) return Math.max(1, Math.ceil(totalTeams / 2));
  const prevMatches = roundElimMatchesForRound(totalTeams, round - 1);
  return Math.floor(prevMatches / 2);
};

const getRoundElimRuleForRound = (bracket, roundNum) => {
  const blueprint = bracket?.config?.blueprint || {};
  const roundRules = Array.isArray(blueprint.roundRules) ? blueprint.roundRules : [];
  const baseRule = clampMatchRules(
    bracket?.config?.rules || blueprint.rules || null,
    DEFAULT_MATCH_RULES
  );
  const roundRule = roundRules[Math.max(0, Number(roundNum || 1) - 1)];
  return clampMatchRules(roundRule, baseRule);
};

const buildRoundElimSeedsForSlot = (bracket, drawSize, r1Pairs, roundNum, orderNum) => {
  if (Number(roundNum) === 1) {
    const prefillSeeds = Array.isArray(bracket?.prefill?.seeds)
      ? bracket.prefill.seeds
      : [];
    const prefillEntry = prefillSeeds[orderNum] || {};
    const idxA = orderNum * 2 + 1;
    const idxB = orderNum * 2 + 2;

    const fallbackA = defaultRoundElimRegistrationSeed(idxA);
    const fallbackB =
      idxB <= drawSize ? defaultRoundElimRegistrationSeed(idxB) : ROUND_ELIM_BYE_SEED;

    return {
      seedA: cloneRoundElimSeed(prefillEntry?.A, fallbackA) || fallbackA,
      seedB: cloneRoundElimSeed(prefillEntry?.B, fallbackB) || fallbackB,
    };
  }

  const prevPairs =
    Number(roundNum) === 2
      ? r1Pairs
      : Math.max(0, roundElimMatchesForRound(drawSize, Number(roundNum) - 1));
  const leftOrder = orderNum * 2;
  const rightOrder = orderNum * 2 + 1;

  return {
    seedA: {
      type: "stageMatchLoser",
      ref: {
        stageIndex: Number(bracket?.stage || 0),
        round: Number(roundNum) - 1,
        order: leftOrder,
      },
      label: `L-V${Number(roundNum) - 1}-T${leftOrder + 1}`,
    },
    seedB:
      rightOrder < prevPairs
        ? {
            type: "stageMatchLoser",
            ref: {
              stageIndex: Number(bracket?.stage || 0),
              round: Number(roundNum) - 1,
              order: rightOrder,
            },
            label: `L-V${Number(roundNum) - 1}-T${rightOrder + 1}`,
          }
        : cloneRoundElimSeed(ROUND_ELIM_BYE_SEED, ROUND_ELIM_BYE_SEED),
  };
};

const roundElimRegistrationSeedFromId = (registrationId) => ({
  type: "registration",
  ref: { registration: registrationId },
  label: "",
});

const getLatestCommittedRoundElimPairsByBracketId = async (bracketIds = []) => {
  const ids = bracketIds
    .map((id) => String(id || ""))
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (!ids.length) return new Map();

  const sessions = await DrawSession.find({
    bracket: { $in: ids },
    mode: "po",
    status: "committed",
    "board.type": "roundElim",
  })
    .select("bracket board committedAt createdAt")
    .sort({ committedAt: -1, createdAt: -1 })
    .lean();

  const out = new Map();
  for (const session of sessions) {
    const bracketId = String(session?.bracket || "");
    if (!bracketId || out.has(bracketId)) continue;
    out.set(
      bracketId,
      Array.isArray(session?.board?.pairs) ? session.board.pairs : []
    );
  }

  return out;
};

const applyCommittedRoundElimPairToSeeds = (seeds, pair) => {
  const hasA = Boolean(pair?.a);
  const hasB = Boolean(pair?.b);
  if (!hasA && !hasB) return { ...seeds, hasCommittedPair: false };

  return {
    seedA: hasA
      ? roundElimRegistrationSeedFromId(pair.a)
      : cloneRoundElimSeed(ROUND_ELIM_BYE_SEED, ROUND_ELIM_BYE_SEED),
    seedB: hasB
      ? roundElimRegistrationSeedFromId(pair.b)
      : cloneRoundElimSeed(ROUND_ELIM_BYE_SEED, ROUND_ELIM_BYE_SEED),
    pairA: hasA ? pair.a : null,
    pairB: hasB ? pair.b : null,
    hasCommittedPair: true,
  };
};

const isRoundElimByeSeed = (seed) =>
  String(seed?.type || "").toLowerCase() === "bye" ||
  String(seed?.label || "").trim().toUpperCase() === "BYE";

const sameRoundElimSeed = (left, right) =>
  JSON.stringify(left || null) === JSON.stringify(right || null);

const resolveRoundElimLoserSeedSlot = (seed, bracketId, existingByKey) => {
  const type = String(seed?.type || "");
  if (type !== "stageMatchLoser" && type !== "matchLoser") {
    return { resolved: false };
  }

  const sourceRound = Number(seed?.ref?.round);
  const sourceOrder = Number(seed?.ref?.order);
  if (!Number.isFinite(sourceRound) || !Number.isFinite(sourceOrder)) {
    return { resolved: false };
  }

  const sourceMatch = existingByKey.get(
    `${String(bracketId)}:${sourceRound}:${sourceOrder}`
  );
  if (!sourceMatch) return { resolved: false };

  const sourceByeA = isRoundElimByeSeed(sourceMatch?.seedA);
  const sourceByeB = isRoundElimByeSeed(sourceMatch?.seedB);
  if (sourceByeA || sourceByeB) {
    return {
      resolved: true,
      pair: null,
      seed: cloneRoundElimSeed(ROUND_ELIM_BYE_SEED, ROUND_ELIM_BYE_SEED),
    };
  }

  if (
    String(sourceMatch?.status || "").toLowerCase() !== "finished" ||
    !["A", "B"].includes(String(sourceMatch?.winner || ""))
  ) {
    return { resolved: false };
  }

  return {
    resolved: true,
    pair: sourceMatch.winner === "A" ? sourceMatch.pairB : sourceMatch.pairA,
    seed: seed || null,
  };
};

const ensureRoundElimBracketMatches = async (tournamentId) => {
  const brackets = await Bracket.find({
    tournament: tournamentId,
    type: { $in: Array.from(ROUND_ELIM_TYPES) },
  })
    .select("_id tournament type stage order prefill meta config")
    .lean();

  if (!brackets.length) return;

  const existingMatches = await Match.find({
    tournament: tournamentId,
    bracket: { $in: brackets.map((bracket) => bracket._id) },
  })
    .select(
      "_id bracket round order seedA seedB pairA pairB status winner rules bestOf pointsToWin winByTwo capMode capPoints"
    )
    .lean();

  const existingByKey = new Map(
    existingMatches.map((match) => [
      `${String(match.bracket)}:${Number(match.round || 1)}:${Number(match.order || 0)}`,
      match,
    ])
  );

  const ops = [];
  const touchedBracketIds = new Set();
  const committedPairsByBracketId =
    await getLatestCommittedRoundElimPairsByBracketId(
      brackets.map((bracket) => bracket._id)
    );

  for (const bracket of brackets) {
    const bracketId = String(bracket?._id || "");
    if (!bracketId) continue;

    const drawSize = Math.max(
      0,
      Number(
        bracket?.config?.roundElim?.drawSize ||
          bracket?.config?.blueprint?.drawSize ||
          (Array.isArray(bracket?.prefill?.seeds) ? bracket.prefill.seeds.length * 2 : 0) ||
          Number(bracket?.meta?.expectedFirstRoundMatches || 0) * 2 ||
          bracket?.meta?.drawSize ||
          0
      )
    );
    const r1Pairs = Math.max(
      1,
      Number(
        bracket?.meta?.expectedFirstRoundMatches ||
          (Array.isArray(bracket?.prefill?.seeds) ? bracket.prefill.seeds.length : 0) ||
          Math.ceil(drawSize / 2) ||
          1
      )
    );
    const maxRounds = Math.max(
      1,
      Number(
        bracket?.meta?.maxRounds ||
          bracket?.config?.roundElim?.maxRounds ||
          bracket?.config?.roundElim?.cutRounds ||
          bracket?.config?.blueprint?.maxRounds ||
          1
      )
    );

    for (let roundNum = 1; roundNum <= maxRounds; roundNum += 1) {
      const expectedMatches =
        roundNum === 1
          ? r1Pairs
          : Math.max(0, roundElimMatchesForRound(drawSize, roundNum));

      if (roundNum > 1 && expectedMatches <= 0) break;

      for (let orderNum = 0; orderNum < Math.max(1, expectedMatches); orderNum += 1) {
        const key = `${bracketId}:${roundNum}:${orderNum}`;
        const existingMatch = existingByKey.get(key) || null;
        let seeds = buildRoundElimSeedsForSlot(
          bracket,
          drawSize,
          r1Pairs,
          roundNum,
          orderNum
        );
        if (roundNum === 1) {
          const committedPairs = committedPairsByBracketId.get(bracketId) || [];
          const committedPair =
            committedPairs.find((pair) => Number(pair?.index) === orderNum) ||
            committedPairs[orderNum] ||
            null;
          seeds = applyCommittedRoundElimPairToSeeds(seeds, committedPair);
        }
        const roundRule = getRoundElimRuleForRound(bracket, roundNum);

        if (!existingMatch) {
          const doc = {
            tournament: bracket.tournament,
            bracket: bracket._id,
            format: "roundElim",
            round: roundNum,
            order: orderNum,
            seedA: seeds.seedA,
            seedB: seeds.seedB,
            pairA: seeds.hasCommittedPair ? seeds.pairA : null,
            pairB: seeds.hasCommittedPair ? seeds.pairB : null,
            rules: roundRule,
            bestOf: roundRule.bestOf,
            pointsToWin: roundRule.pointsToWin,
            winByTwo: roundRule.winByTwo,
            capMode: roundRule.cap?.mode ?? "none",
            capPoints: roundRule.cap?.points ?? null,
          };

          ops.push({
            updateOne: {
              filter: {
                tournament: bracket.tournament,
                bracket: bracket._id,
                round: roundNum,
                order: orderNum,
              },
              update: { $setOnInsert: doc },
              upsert: true,
            },
          });
          touchedBracketIds.add(bracketId);
          continue;
        }

        const patch = {};
        if (!existingMatch?.seedA?.type && seeds.seedA) patch.seedA = seeds.seedA;
        if (!existingMatch?.seedB?.type && seeds.seedB) patch.seedB = seeds.seedB;
        if (
          seeds.hasCommittedPair &&
          String(existingMatch?.status || "").toLowerCase() !== "finished"
        ) {
          if (String(existingMatch?.pairA || "") !== String(seeds.pairA || "")) {
            patch.pairA = seeds.pairA;
          }
          if (String(existingMatch?.pairB || "") !== String(seeds.pairB || "")) {
            patch.pairB = seeds.pairB;
          }
          if (seeds.seedA) patch.seedA = seeds.seedA;
          if (seeds.seedB) patch.seedB = seeds.seedB;
        }
        if (!existingMatch?.rules && roundRule) patch.rules = roundRule;
        if (!Number.isFinite(Number(existingMatch?.bestOf)))
          patch.bestOf = roundRule.bestOf;
        if (!Number.isFinite(Number(existingMatch?.pointsToWin)))
          patch.pointsToWin = roundRule.pointsToWin;
        if (typeof existingMatch?.winByTwo !== "boolean")
          patch.winByTwo = roundRule.winByTwo;
        if (!existingMatch?.capMode) patch.capMode = roundRule.cap?.mode ?? "none";
        if (
          existingMatch?.capPoints === undefined &&
          roundRule.cap?.points !== undefined
        ) {
          patch.capPoints = roundRule.cap.points;
        }
        if (
          roundNum > 1 &&
          !["live", "finished"].includes(
            String(existingMatch?.status || "").toLowerCase()
          )
        ) {
          const resolvedA = resolveRoundElimLoserSeedSlot(
            seeds.seedA || existingMatch?.seedA,
            bracketId,
            existingByKey
          );
          const resolvedB = resolveRoundElimLoserSeedSlot(
            seeds.seedB || existingMatch?.seedB,
            bracketId,
            existingByKey
          );
          if (
            resolvedA.resolved &&
            String(existingMatch?.pairA || "") !== String(resolvedA.pair || "")
          ) {
            patch.pairA = resolvedA.pair || null;
          }
          if (
            resolvedB.resolved &&
            String(existingMatch?.pairB || "") !== String(resolvedB.pair || "")
          ) {
            patch.pairB = resolvedB.pair || null;
          }
          const expectedSeedA = resolvedA.resolved ? resolvedA.seed : seeds.seedA;
          const expectedSeedB = resolvedB.resolved ? resolvedB.seed : seeds.seedB;
          if (expectedSeedA && !sameRoundElimSeed(existingMatch?.seedA, expectedSeedA)) {
            patch.seedA = expectedSeedA;
          }
          if (expectedSeedB && !sameRoundElimSeed(existingMatch?.seedB, expectedSeedB)) {
            patch.seedB = expectedSeedB;
          }
        }

        if (Object.keys(patch).length) {
          ops.push({
            updateOne: {
              filter: { _id: existingMatch._id },
              update: { $set: patch },
            },
          });
          touchedBracketIds.add(bracketId);
        }
      }
    }
  }

  if (!ops.length) return;

  await Match.bulkWrite(ops, { ordered: false });

  if (typeof Match.compileSeedsForBracket === "function") {
    for (const bracketId of touchedBracketIds) {
      await Match.compileSeedsForBracket(bracketId);
    }
  }
};

const getTournamentBracketBaseByBracketId = async (tournamentId) => {
  const objectId = new mongoose.Types.ObjectId(tournamentId);
  const allBrackets = await Bracket.find({ tournament: tournamentId })
    .select("_id type stage order prefill ko meta config drawRounds")
    .lean();

  const roundsAgg = await Match.aggregate([
    { $match: { tournament: objectId } },
    { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
  ]);

  const maxRoundByBracket = new Map(
    roundsAgg.map((row) => [String(row._id), Number(row.maxRound) || 0])
  );

  const typeKey = (type) => String(type || "").toLowerCase();
  const isGroupish = (type) => {
    const key = typeKey(type);
    return key === "group" || key === "round_robin" || key === "gsl";
  };
  const teamsFromRoundKey = (key) => {
    if (!key) return 0;
    const upper = String(key).toUpperCase();
    if (upper === "F") return 2;
    if (upper === "SF") return 4;
    if (upper === "QF") return 8;
    const matched = /^R(\d+)$/i.exec(upper);
    return matched ? parseInt(matched[1], 10) : 0;
  };
  const ceilPow2 = (value) =>
    Math.pow(2, Math.ceil(Math.log2(Math.max(1, value || 1))));
  const readBracketScale = (bracket) => {
    const fromKey =
      teamsFromRoundKey(bracket?.ko?.startKey) ||
      teamsFromRoundKey(bracket?.prefill?.roundKey);
    const fromPrefillPairs = Array.isArray(bracket?.prefill?.pairs)
      ? bracket.prefill.pairs.length * 2
      : 0;
    const fromPrefillSeeds = Array.isArray(bracket?.prefill?.seeds)
      ? bracket.prefill.seeds.length * 2
      : 0;
    const candidates = [
      bracket?.drawScale,
      bracket?.targetScale,
      bracket?.maxSlots,
      bracket?.capacity,
      bracket?.size,
      bracket?.scale,
      bracket?.meta?.drawSize,
      bracket?.meta?.scale,
      fromKey,
      fromPrefillPairs,
      fromPrefillSeeds,
    ]
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 2);
    return candidates.length ? ceilPow2(Math.max(...candidates)) : 0;
  };
  const roundsCountForBracket = (bracket) => {
    const type = typeKey(bracket?.type);
    const bracketId = String(bracket?._id || "");
    if (isGroupish(type)) return 1;

    if (["roundelim", "po", "playoff"].includes(type)) {
      let value =
        Number(bracket?.meta?.maxRounds) ||
        Number(bracket?.config?.roundElim?.maxRounds) ||
        0;
      if (!value) value = maxRoundByBracket.get(bracketId) || 1;
      return Math.max(1, value);
    }

    const fromMatches = maxRoundByBracket.get(bracketId) || 0;
    if (fromMatches) return Math.max(1, fromMatches);

    const firstPairs =
      (Array.isArray(bracket?.prefill?.seeds) && bracket.prefill.seeds.length) ||
      (Array.isArray(bracket?.prefill?.pairs) && bracket.prefill.pairs.length) ||
      0;
    if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));

    const scale = readBracketScale(bracket);
    if (scale) return Math.ceil(Math.log2(scale));

    const drawRounds = Number(bracket?.drawRounds || 0);
    return drawRounds ? Math.max(1, drawRounds) : 1;
  };

  const groupBrackets = allBrackets.filter((bracket) => isGroupish(bracket.type));
  const nonGroupBrackets = allBrackets.filter(
    (bracket) => !isGroupish(bracket.type)
  );
  const stageValue = (bracket) =>
    Number.isFinite(bracket?.stage) ? Number(bracket.stage) : 9999;

  const buckets = [];
  if (groupBrackets.length) {
    buckets.push({
      key: "group",
      isGroup: true,
      brackets: groupBrackets,
      spanRounds: 1,
      stageHint: 1,
      orderHint: Math.min(
        ...groupBrackets.map((bracket) => Number(bracket?.order ?? 0))
      ),
    });
  }

  const byStage = new Map();
  for (const bracket of nonGroupBrackets) {
    const stage = stageValue(bracket);
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(bracket);
  }

  const stageKeys = Array.from(byStage.keys()).sort((a, b) => a - b);
  for (const stage of stageKeys) {
    const brackets = byStage.get(stage);
    const span =
      Math.max(...brackets.map((bracket) => roundsCountForBracket(bracket))) || 1;
    buckets.push({
      key: `stage-${stage}`,
      isGroup: false,
      brackets,
      spanRounds: span,
      stageHint: stage,
      orderHint: Math.min(
        ...brackets.map((bracket) => Number(bracket?.order ?? 0))
      ),
    });
  }

  buckets.sort((a, b) => {
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;
    if (a.stageHint !== b.stageHint) return a.stageHint - b.stageHint;
    return a.orderHint - b.orderHint;
  });

  const baseByBracketId = new Map();
  let accumulated = 0;
  for (const bucket of buckets) {
    for (const bracket of bucket.brackets) {
      baseByBracketId.set(String(bracket._id), accumulated);
    }
    accumulated += bucket.spanRounds;
  }

  return { baseByBracketId };
};

const enrichBracketMatchList = async (tournamentId, listRaw) => {
  const { baseByBracketId } = await getTournamentBracketBaseByBracketId(
    tournamentId
  );
  const latestRecordingsByMatchId = await getLatestRecordingsByMatchIds(listRaw);
  const resolvePublicCourtMeta = (match) => {
    const stationId =
      match?.courtStationId || match?.courtStation?._id || match?.courtStation;
    const stationName =
      match?.courtStationName || match?.courtStationLabel || "";
    const stationStatus = match?.courtStation?.status || "";
    const stationOrder = Number.isFinite(match?.courtStation?.order)
      ? match.courtStation.order
      : null;
    const stationCluster =
      match?.courtClusterName || match?.courtClusterLabel || "";

    return {
      courtId: stationId || match?.court?._id || match?.court || null,
      courtName: stationName || match?.court?.name || match?.courtLabel || "",
      courtStatus: stationStatus || match?.court?.status || "",
      courtOrder:
        stationOrder ??
        (Number.isFinite(match?.court?.order) ? match.court.order : null),
      courtBracket: match?.court?.bracket || null,
      courtCluster:
        stationCluster || match?.court?.cluster || match?.courtCluster || "",
    };
  };

  const safeInt = (value) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : undefined;
  };
  const alphaToNum = (value) => {
    const matched = String(value || "")
      .trim()
      .match(/^[A-Za-z]/);
    if (!matched) return undefined;
    return matched[0].toUpperCase().charCodeAt(0) - 64;
  };
  const typeKey = (type) => String(type || "").toLowerCase();
  const isGroupish = (type) => {
    const key = typeKey(type);
    return key === "group" || key === "round_robin" || key === "gsl";
  };
  const getGroupNo = (match, bracket) => {
    const poolName =
      match?.pool?.name || match?.pool?.key || match?.groupCode || "";
    if (poolName) {
      const numeric = String(poolName).match(/\d+/);
      if (numeric) return parseInt(numeric[0], 10);
      const alpha = alphaToNum(poolName);
      if (alpha) return alpha;
    }

    const groups = Array.isArray(bracket?.groups) ? bracket.groups : [];
    if (groups.length) {
      if (match?.pool?.id) {
        const groupIndex = groups.findIndex(
          (group) => String(group?._id) === String(match.pool.id)
        );
        if (groupIndex >= 0) return groupIndex + 1;
      }
      if (poolName) {
        const groupIndex = groups.findIndex(
          (group) =>
            String(group?.name || "")
              .trim()
              .toUpperCase() === String(poolName).trim().toUpperCase()
        );
        if (groupIndex >= 0) return groupIndex + 1;
      }
    }

    const directCandidates = [
      match?.groupNo,
      match?.groupIndex,
      match?.groupIdx,
      match?.group,
      match?.meta?.groupNo,
      match?.meta?.groupIndex,
      match?.meta?.pool,
      match?.group?.no,
      match?.group?.index,
      match?.group?.order,
      match?.pool?.index,
      match?.pool?.no,
      match?.pool?.order,
    ];
    for (const candidate of directCandidates) {
      const numeric = safeInt(candidate);
      if (typeof numeric === "number") return numeric <= 0 ? 1 : numeric;
    }
    return undefined;
  };
  const getGroupOrder = (match) => {
    const matched = String(match?.labelKey || "").match(/#(\d+)\s*$/);
    if (matched) return parseInt(matched[1], 10);
    const orderInGroup =
      safeInt(match?.orderInGroup) ?? safeInt(match?.meta?.orderInGroup);
    if (typeof orderInGroup === "number") return orderInGroup + 1;
    const order = safeInt(match?.order);
    if (typeof order === "number") return order + 1;
    return 1;
  };
  const getKnockoutOrder = (match) => {
    const matched = String(match?.labelKey || "").match(/#(\d+)\s*$/);
    if (matched) return parseInt(matched[1], 10);
    const order =
      safeInt(match?.order) ??
      safeInt(match?.meta?.order) ??
      safeInt(match?.matchNo) ??
      safeInt(match?.index) ??
      0;
    return order + 1;
  };

  const normalizedList = listRaw.map((rawMatch) =>
    normalizeMatchDisplayShape(rawMatch)
  );
  const matchesByBracketId = new Map();
  for (const match of normalizedList) {
    const bracketId = String(match?.bracket?._id || match?.bracket || "");
    if (!bracketId) continue;
    if (!matchesByBracketId.has(bracketId)) matchesByBracketId.set(bracketId, []);
    matchesByBracketId.get(bracketId).push(match);
  }
  await hydrateResolvedPairsInMatchList(normalizedList, {
    baseByBracketId,
    matchesByBracketId,
  });

  const enrichedList = normalizedList.map((match) => {
    const bracket = match.bracket || {};
    const bracketId = String(bracket?._id || "");
    const groupStage = isGroupish(bracket?.type);

    const baseRound = baseByBracketId.get(bracketId) ?? 0;
    const localRound = groupStage
      ? 1
      : Number.isFinite(match.round)
      ? match.round
      : 1;
    const globalRound = baseRound + localRound;

    let code;
    if (groupStage) {
      const groupNo = getGroupNo(match, bracket);
      const groupOrder = getGroupOrder(match);
      code = `V1-${groupNo ? `B${groupNo}` : "B?"}-T${groupOrder}`;
    } else {
      code = `V${globalRound}-T${getKnockoutOrder(match)}`;
    }

    const fallbackVideo =
      match?.facebookLive?.video_permalink_url ||
      match?.facebookLive?.permalink_url ||
      "";
    const publicCourtMeta = resolvePublicCourtMeta(match);

    const enrichedMatch = {
      ...match,
      video:
        typeof match?.video === "string" && match.video.trim()
          ? match.video.trim()
          : fallbackVideo,
      ...publicCourtMeta,
      globalRound,
      globalCode: `V${globalRound}`,
      code,
    };
    return attachPublicStreamsToMatch(
      enrichedMatch,
      latestRecordingsByMatchId.get(String(match?._id || ""))
    );
  });
  attachBackendResolvedSideNamesToMatches(enrichedList);
  return enrichedList;
};

const listTournamentMatchesBracketView = async (req, res) => {
  const { id } = req.params;
  setNoStoreHeaders(res);
  await ensureRoundElimBracketMatches(id);

  const listRaw = await Match.find({ tournament: id })
    .select(
      [
        "tournament",
        "bracket",
        "format",
        "branch",
        "phase",
        "pool",
        "round",
        "order",
        "stageIndex",
        "labelKey",
        "displayCode",
        "codeResolved",
        "code",
        "matchCode",
        "meta.groupNo",
        "meta.groupIndex",
        "meta.pool",
        "meta.orderInGroup",
        "meta.order",
        "seedA",
        "seedB",
        "pairA",
        "pairB",
        "previousA",
        "previousB",
        "isThirdPlace",
        "meta.thirdPlace",
        "meta.stageLabel",
        "rules",
        "currentGame",
        "gameScores",
        "status",
        "winner",
        "referee",
        "scheduledAt",
        "startedAt",
        "finishedAt",
        "assignedAt",
        "court",
        "courtStation",
        "courtLabel",
        "courtCluster",
        "courtClusterId",
        "courtClusterLabel",
        "courtStationLabel",
        "queueOrder",
        "serve",
        "liveVersion",
        "video",
        "facebookLive.permalink_url",
        "facebookLive.video_permalink_url",
        "createdAt",
      ].join(" ")
    )
    .populate({
      path: "tournament",
      select: "name image eventType nameDisplayMode",
    })
    .populate({
      path: "bracket",
      select: [
        "name",
        "type",
        "stage",
        "order",
        "drawRounds",
        "drawStatus",
        "scheduler",
        "drawSettings",
        "noRankDelta",
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        "groups._id",
        "groups.name",
        "groups.expectedSize",
        "config.rules",
        "config.doubleElim",
        "config.roundRobin",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
        "overlay",
      ].join(" "),
    })
    .populate(MATCH_PAIR_POPULATE("pairA"))
    .populate(MATCH_PAIR_POPULATE("pairB"))
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({
      path: "court",
      select:
        "name number code label zone area venue building floor cluster status bracket order",
    })
    .populate({
      path: "courtStation",
      select: "name code status order clusterId",
    })
    .sort({ round: 1, order: 1, createdAt: 1 })
    .lean();

  const payload = await enrichBracketMatchList(id, listRaw);
  setNoStoreHeaders(res);
  return res.json(payload);
};

const listTournamentMatchesScheduleView = async (req, res) => {
  const { id } = req.params;
  setNoStoreHeaders(res);
  const listRaw = await Match.find({ tournament: id })
    .select(
      [
        "tournament",
        "bracket",
        "format",
        "branch",
        "phase",
        "pool",
        "round",
        "order",
        "stageIndex",
        "labelKey",
        "displayCode",
        "codeResolved",
        "code",
        "matchCode",
        "meta.groupNo",
        "meta.groupIndex",
        "meta.pool",
        "meta.orderInGroup",
        "meta.order",
        "seedA",
        "seedB",
        "pairA",
        "pairB",
        "previousA",
        "previousB",
        "currentGame",
        "gameScores",
        "status",
        "winner",
        "referee",
        "scheduledAt",
        "startedAt",
        "finishedAt",
        "assignedAt",
        "court",
        "courtStation",
        "courtLabel",
        "courtCluster",
        "courtClusterId",
        "courtClusterLabel",
        "courtStationLabel",
        "queueOrder",
        "serve",
        "liveVersion",
        "video",
        "facebookLive.permalink_url",
        "facebookLive.video_permalink_url",
        "createdAt",
        "updatedAt",
      ].join(" ")
    )
    .populate({
      path: "tournament",
      select: "name image eventType nameDisplayMode",
    })
    .populate({
      path: "bracket",
      select: "name type stage order groups._id groups.name",
    })
    .populate(MATCH_PAIR_POPULATE("pairA"))
    .populate(MATCH_PAIR_POPULATE("pairB"))
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({
      path: "court",
      select: "name cluster status order",
    })
    .populate({
      path: "courtStation",
      select: "name code status order clusterId",
    })
    .sort({ round: 1, order: 1, createdAt: 1 })
    .lean();

  const list = await enrichBracketMatchList(id, listRaw);
  const payload = {
    total: list.length,
    page: 1,
    limit: list.length,
    list,
  };

  setNoStoreHeaders(res);
  return res.json(payload);
};
// @desc    Lấy danh sách giải đấu (lọc theo sportType & groupId)
// @route   GET /api/tournaments?sportType=&groupId=
// @access  Public

/**
 * GET /api/tournaments/public
 * Query:
 *  - sportType: Number (1/2)
 *  - groupId:   Number
 *  - sort:      string, ví dụ "-startDate,name" (mặc định: "-startDate")
 *  - limit:     number (optional)
 */
// GET /tournaments
const getTournaments = asyncHandler(async (req, res) => {
  const hasSortQP = Object.prototype.hasOwnProperty.call(req.query, "sort");
  const sortQP = (req.query.sort || "").toString().trim();
  const limit = req.query.limit
    ? Math.max(parseInt(req.query.limit, 10) || 0, 0)
    : null;
  const status = (req.query.status || "").toString().toLowerCase(); // upcoming|ongoing|finished (chỉ dùng lọc nếu có)
  const rawKeyword = (req.query.keyword ?? req.query.q ?? "").toString().trim();

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parseSort = (s) =>
    s.split(",").reduce((acc, token) => {
      const key = token.trim();
      if (!key) return acc;
      if (key.startsWith("-")) acc[key.slice(1)] = -1;
      else acc[key] = 1;
      return acc;
    }, {});
  const sortSpecFromQP = hasSortQP ? parseSort(sortQP) : {};

  const pipeline = [];

  // ----- Search (keyword / q) -----
  if (rawKeyword) {
    const tokens = rawKeyword.split(/\s+/).filter(Boolean).map(escapeRegex);
    const tokenConds = tokens.map((tk) => ({
      $or: [
        { name: { $regex: tk, $options: "i" } },
        { slug: { $regex: tk, $options: "i" } },
        { code: { $regex: tk, $options: "i" } },
        { "location.city": { $regex: tk, $options: "i" } },
        { "location.province": { $regex: tk, $options: "i" } },
        { location: { $regex: tk, $options: "i" } },
        { venueName: { $regex: tk, $options: "i" } },
      ],
    }));

    const orExpr = [];
    if (tokenConds.length) orExpr.push({ $and: tokenConds });

    if (mongoose.Types.ObjectId.isValid(rawKeyword)) {
      orExpr.push({ _id: new mongoose.Types.ObjectId(rawKeyword) });
    }

    pipeline.push({
      $match: orExpr.length === 1 ? orExpr[0] : { $or: orExpr },
    });
  }

  // ----- Chuẩn hoá mốc thời gian -----
  pipeline.push({
    $addFields: {
      _startInstant: { $ifNull: ["$startAt", "$startDate"] },
      _endInstant: {
        $ifNull: [
          { $ifNull: ["$endAt", "$endDate"] },
          { $ifNull: ["$startAt", "$startDate"] }, // fallback
        ],
      },
    },
  });

  // ----- Tính “độ gần để sort” KHÔNG dựa trên status -----
  // nearDeltaMs: 0 cho giải đang diễn ra (now ∈ [start,end])
  //              (start - now) cho giải sắp diễn ra
  //              (now - end) cho giải đã kết thúc
  // tieMs:      ưu tiên kết thúc sớm hơn trong ongoing; bắt đầu sớm hơn trong upcoming; kết thúc gần hơn trong finished
  pipeline.push(
    {
      $addFields: {
        _isOngoing: {
          $and: [
            { $lte: ["$_startInstant", "$$NOW"] },
            { $gte: ["$_endInstant", "$$NOW"] },
          ],
        },
        _isUpcoming: { $gt: ["$_startInstant", "$$NOW"] },
      },
    },
    {
      $addFields: {
        nearDeltaMs: {
          $cond: [
            "$_isOngoing",
            0,
            {
              $cond: [
                "$_isUpcoming",
                { $subtract: ["$_startInstant", "$$NOW"] },
                { $subtract: ["$$NOW", "$_endInstant"] },
              ],
            },
          ],
        },
        tieMs: {
          $cond: [
            "$_isOngoing",
            { $max: [0, { $subtract: ["$_endInstant", "$$NOW"] }] }, // sắp kết thúc trước → lên trước
            {
              $cond: [
                "$_isUpcoming",
                { $max: [0, { $subtract: ["$_startInstant", "$$NOW"] }] }, // bắt đầu sớm hơn → lên trước
                { $max: [0, { $subtract: ["$$NOW", "$_endInstant"] }] }, // vừa kết thúc → lên trước
              ],
            },
          ],
        },
      },
    }
  );

  // ----- (Tuỳ chọn) Lọc theo status nếu client truyền, nhưng KHÔNG dùng status để sort -----
  if (["upcoming", "ongoing", "finished"].includes(status)) {
    // dùng status lưu trong DB (nếu muốn vẫn có thể tính runtime như trước)
    pipeline.push({ $match: { status } });
  }

  // ----- Sort / Limit -----
  // Ưu tiên tuyệt đối theo nearDeltaMs -> tieMs; sau đó cho phép ép thêm trường phụ từ QP (nếu có) -> _id ổn định
  pipeline.push({
    $sort: {
      nearDeltaMs: 1,
      tieMs: 1,
      ...sortSpecFromQP,
      _id: -1,
    },
  });
  if (limit) pipeline.push({ $limit: limit });

  // ----- registered / isFull / remaining -----
  pipeline.push(
    {
      $lookup: {
        from: "registrations",
        let: { tid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tid"] } } },
          { $group: { _id: null, c: { $sum: 1 } } },
        ],
        as: "_rc",
      },
    },
    {
      $addFields: {
        registered: { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
        isFull: {
          $cond: [
            {
              $and: [
                { $gt: ["$maxPairs", 0] },
                {
                  $gte: [
                    { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
                    "$maxPairs",
                  ],
                },
              ],
            },
            true,
            false,
          ],
        },
        remaining: {
          $cond: [
            { $gt: ["$maxPairs", 0] },
            {
              $max: [
                0,
                {
                  $subtract: [
                    "$maxPairs",
                    { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
                  ],
                },
              ],
            },
            null,
          ],
        },
      },
    }
  );

  // ----- Bracket stats / effectiveNoRankDelta -----
  pipeline.push(
    {
      $lookup: {
        from: "brackets",
        let: { tid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$tournament", "$$tid"] } } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              noRankOn: {
                $sum: { $cond: [{ $eq: ["$noRankDelta", true] }, 1, 0] },
              },
            },
          },
        ],
        as: "_bc",
      },
    },
    {
      $addFields: {
        bracketsTotal: { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
        bracketsNoRankDeltaTrue: {
          $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0],
        },
        allBracketsNoRankDelta: {
          $cond: [
            { $gt: [{ $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] }, 0] },
            {
              $eq: [
                { $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0] },
                { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
              ],
            },
            false,
          ],
        },
        effectiveNoRankDelta: {
          $or: [
            { $eq: ["$noRankDelta", true] },
            {
              $cond: [
                {
                  $gt: [
                    { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
                    0,
                  ],
                },
                {
                  $eq: [
                    { $ifNull: [{ $arrayElemAt: ["$_bc.noRankOn", 0] }, 0] },
                    { $ifNull: [{ $arrayElemAt: ["$_bc.total", 0] }, 0] },
                  ],
                },
                false,
              ],
            },
          ],
        },
      },
    },
    {
      $project: {
        _rc: 0,
        _bc: 0,
        _startInstant: 0,
        _endInstant: 0,
        _isOngoing: 0,
        _isUpcoming: 0,
        nearDeltaMs: 0,
        tieMs: 0,
      },
    }
  );

  const tournaments = await Promise.all(
    (await Tournament.aggregate(pipeline)).map((t) =>
      normalizeTournamentPublicUrls(req, t)
    )
  );
  res.status(200).json(tournaments);
});

const getTournamentById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  const tour = await Tournament.findById(id)
    .populate("allowedCourtClusterIds", "name slug venueName isActive order")
    .populate("teamConfig.factions.captainUser", "name nickname avatar phone")
    .lean();
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const [managerRows, registrationsCount, checkedInCount, paidCount] =
    await Promise.all([
      TournamentManager.find({ tournament: id }).select("user role").lean(),
      Registration.countDocuments({ tournament: id }),
      Registration.countDocuments({
        tournament: id,
        checkinAt: { $ne: null },
      }),
      Registration.countDocuments({
        tournament: id,
        "payment.status": "Paid",
      }),
    ]);

  const managers = managerRows.map((r) => ({ user: r.user, role: r.role }));
  const now = new Date();
  const startInstant = tour.startAt || tour.startDate;
  const endInstant = tour.endAt || tour.endDate;

  let status = "upcoming";
  if (tour.finishedAt) status = "finished";
  else if (startInstant && now < new Date(startInstant)) status = "upcoming";
  else if (endInstant && now > new Date(endInstant)) status = "finished";
  else status = "ongoing";

  const isFreeRegistration = tour.isFreeRegistration === true;
  const bankShortName = isFreeRegistration
    ? ""
    : tour.bankShortName || tour.qrBank || tour.bankCode || tour.bank || "";
  const bankAccountNumber = isFreeRegistration
    ? ""
    : tour.bankAccountNumber || tour.qrAccount || tour.bankAccount || "";
  const bankAccountName = isFreeRegistration
    ? ""
    : tour.bankAccountName ||
      tour.accountName ||
      tour.paymentAccountName ||
      tour.beneficiaryName ||
      "";
  const registrationFee = (() => {
    if (isFreeRegistration) return 0;
    const raw = tour.registrationFee ?? tour.fee ?? tour.entryFee ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  })();

  const normalizedTour = await normalizeTournamentPublicUrls(req, tour);
  const payload = {
    ...normalizedTour,
    allowedCourtClusters: Array.isArray(normalizedTour.allowedCourtClusterIds)
      ? normalizedTour.allowedCourtClusterIds.map((cluster) => ({
          _id: String(cluster?._id || cluster || ""),
          name: String(cluster?.name || "").trim(),
          slug: String(cluster?.slug || "").trim(),
          venueName: String(cluster?.venueName || "").trim(),
          isActive: cluster?.isActive !== false,
          order: Number(cluster?.order || 0),
        }))
      : [],
    tournamentMode: normalizedTour.tournamentMode || "standard",
    teamConfig: {
      factions: Array.isArray(normalizedTour?.teamConfig?.factions)
        ? normalizedTour.teamConfig.factions.map((faction, index) => ({
            _id: String(faction?._id || ""),
            name: String(faction?.name || "").trim(),
            order: Number(faction?.order ?? index),
            isActive: faction?.isActive !== false,
            captainUser: faction?.captainUser || null,
          }))
        : [],
    },
    status,
    managers,
    _managerUserIds: managerRows.map((r) => String(r.user)),
    stats: {
      registrationsCount,
      checkedInCount,
      paidCount,
    },
    bankShortName,
    bankAccountNumber,
    bankAccountName,
    registrationFee,
    isFreeRegistration,
    qrBank: bankShortName,
    qrAccount: bankAccountNumber,
    fee: registrationFee,
    entryFee: registrationFee,
  };

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");

  const meId = req.user?._id ? String(req.user._id) : null;
  const amOwner = !!(meId && String(payload.createdBy) === meId);
  const amManager =
    amOwner ||
    (!!meId &&
      Array.isArray(payload._managerUserIds) &&
      payload._managerUserIds.includes(meId));

  const { _managerUserIds, ...publicPayload } = payload;
  res.json({
    ...publicPayload,
    amOwner,
    amManager,
  });
});

/**
 * GET /api/tournaments/:id/brackets
 * User route: trả về các bracket của giải, sort theo stage -> order -> createdAt
 * Thêm matchesCount (tính qua $lookup, không tốn populate).
 */
// helper

/* ========== Helpers ========== */
function buildKoLabels(B) {
  const labels = [];
  for (let s = B; s >= 2; s >>= 1) {
    if (s === 8) labels.push("QF");
    else if (s === 4) labels.push("SF");
    else if (s === 2) labels.push("F");
    else labels.push(`R${s}`);
  }
  return labels;
}

function sanitizeKoMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ko = { ...raw };
  if (!ko.entrants || ko.entrants <= 1) {
    if (ko.bracketSize && ko.bracketSize >= 2) {
      const labels = buildKoLabels(ko.bracketSize);
      ko.labels = labels;
      ko.rounds = Math.log2(ko.bracketSize) | 0;
      ko.startKey = labels[0];
    } else return null;
  } else {
    const B =
      ko.bracketSize && ko.bracketSize >= 2
        ? ko.bracketSize
        : 1 << Math.ceil(Math.log2(ko.entrants));
    ko.bracketSize = B;
    ko.rounds = Math.log2(B) | 0;
    ko.byes = typeof ko.byes === "number" ? ko.byes : B - ko.entrants;
    ko.labels =
      Array.isArray(ko.labels) && ko.labels.length
        ? ko.labels
        : buildKoLabels(B);
    ko.startKey = ko.startKey || ko.labels[0];
  }
  return ko;
}

/* ========== Controller ========== */
export const listTournamentBrackets = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isId(id)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }

    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-PKT-Cache", "BYPASS");

    const rows = await Bracket.aggregate([
      { $match: { tournament: new mongoose.Types.ObjectId(id) } },
      { $sort: { stage: 1, order: 1, createdAt: 1 } },

      // fallback theo matches (nếu cần)
      {
        $lookup: {
          from: "matches",
          let: { bid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$bracket", "$$bid"] } } },
            { $group: { _id: "$roundKey", matches: { $sum: 1 } } },
            { $project: { _id: 0, roundKey: "$_id", matches: 1 } },
          ],
          as: "_rounds",
        },
      },

      // DrawSession KO mới nhất: LẤY CẢ source & board để FE vẽ sơ đồ prefill
      {
        $lookup: {
          from: "drawsessions",
          let: { bid: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$bracket", "$$bid"] },
                    { $eq: ["$mode", "knockout"] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            { $project: { _id: 1, board: 1, computedMeta: 1, source: 1 } }, // 👈 lấy thêm source
          ],
          as: "_draw",
        },
      },

      // Giữ matchesCount như cũ
      {
        $addFields: {
          matchesCount: { $sum: "$_rounds.matches" },
        },
      },
    ]);

    // === Thu thập mọi regId trong board prefill để map tên ===
    const allIds = new Set();
    for (const b of rows) {
      const ds = Array.isArray(b._draw) ? b._draw[0] : null;
      const pairs = ds?.board?.pairs || [];
      for (const p of pairs) {
        if (p?.a) allIds.add(String(p.a));
        if (p?.b) allIds.add(String(p.b));
      }
    }
    const regIds = [...allIds].map((s) => new mongoose.Types.ObjectId(s));
    let regMap = new Map();
    if (regIds.length) {
      const regs = await Registration.find({ _id: { $in: regIds } })
        .select("_id name displayName team shortName")
        .lean();
      regMap = new Map(
        regs.map((r) => [
          String(r._id),
          {
            name:
              r.displayName ||
              r.shortName ||
              r.name ||
              (r.team ? r.team.name : "Unnamed"),
          },
        ])
      );
    }

    // === Hậu xử lý: build ko + prefill (để FE render sơ đồ ngay cả khi chưa có match) ===
    const list = rows.map((b) => {
      let ko = null;
      let prefill = null;

      if (b.type === "knockout") {
        const ds = Array.isArray(b._draw) ? b._draw[0] : null;

        // 1) ƯU TIÊN: ko meta từ DrawSession
        if (ds?.computedMeta?.ko) {
          const sanitized = sanitizeKoMeta(ds.computedMeta.ko);
          if (sanitized) {
            ko = sanitized;
            if (ds.computedMeta.flags) {
              ko.flags = ds.computedMeta.flags;
            }
          }
        }

        // 2) prefill board để vẽ sơ đồ (kể cả khi entrants null/ BYE)
        if (ds?.board?.pairs?.length) {
          const pairs = ds.board.pairs.map((p) => ({
            index: p.index,
            a: p.a
              ? {
                  id: String(p.a),
                  name: regMap.get(String(p.a))?.name || null,
                }
              : null, // null = BYE
            b: p.b
              ? {
                  id: String(p.b),
                  name: regMap.get(String(p.b))?.name || null,
                }
              : null,
          }));
          prefill = {
            drawId: String(ds._id),
            roundKey: ds.board.roundKey || (ko ? ko.startKey : null),
            isVirtual: !!ds?.computedMeta?.flags?.virtual,
            source: ds?.source
              ? {
                  fromBracket: ds.source.fromBracket
                    ? String(ds.source.fromBracket)
                    : null,
                  fromName: ds.source.fromName || null,
                  fromType: ds.source.fromType || null,
                  mode: ds.source.mode || null,
                  params: ds.source.params || null,
                }
              : null,
            pairs,
          };

          // nếu chưa có ko, suy B từ board
          if (!ko) {
            const B = pairs.length * 2;
            if (B >= 2) {
              const labels = buildKoLabels(B);
              ko = {
                bracketSize: B,
                rounds: Math.log2(B) | 0,
                startKey: labels[0],
                labels,
              };
            }
          }
        }

        // 3) Cuối: nếu vẫn chưa có ko thì fallback từ matches
        if (!ko && Array.isArray(b._rounds) && b._rounds.length) {
          const maxMatches = b._rounds.reduce(
            (m, r) => Math.max(m, r?.matches || 0),
            0
          );
          const B = maxMatches * 2;
          if (B >= 2) {
            const labels = buildKoLabels(B);
            ko = {
              bracketSize: B,
              rounds: Math.log2(B) | 0,
              startKey: labels[0],
              labels,
            };
          }
        }
      }

      // loại bỏ field tạm
      const { _rounds, _draw, ...rest } = b;
      const out = { ...rest };
      if (ko) out.ko = ko;
      if (prefill) out.prefill = prefill;
      return out;
    });

    res.json(list);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tournaments/:id/matches
 * User route: trả về match của giải (có thể lọc theo bracket/type/stage/status).
 * HỖ TRỢ phân trang: ?page=1&limit=50, sort: ?sort=round,order (mặc định round asc, order asc).
 * Populate chuẩn theo schema (KHÔNG dùng 'reg1', 'reg2' — đó là lý do lỗi strictPopulate trước đây).
 */
const toObjectId = (id) => {
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
};

export const getTeamRoster = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("Invalid tournament id");
  }
  const payload = await buildTeamRoster(id);
  res.json(payload);
});

export const getTeamStandings = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) {
    res.status(400);
    throw new Error("Invalid tournament id");
  }
  const payload = await buildTeamStandings(id);
  res.json(payload);
});

export const getRegistrationPoster = asyncHandler(async (req, res) => {
  const { id, regId } = req.params;
  if (!isId(id) || !isId(regId)) {
    res.status(400);
    throw new Error("Invalid tournament or registration id");
  }

  const [tour, reg] = await Promise.all([
    Tournament.findById(id)
      .select("name image eventType nameDisplayMode registrationPosterConfig createdBy")
      .lean(),
    Registration.findOne({ _id: regId, tournament: id })
      .select("player1 player2 payment updatedAt")
      .populate("player1.user", POSTER_USER_SELECT)
      .populate("player2.user", POSTER_USER_SELECT)
      .lean(),
  ]);

  if (!tour || !reg) {
    res.status(404);
    throw new Error("Không tìm thấy đăng ký hoặc giải đấu");
  }
  if (
    reg.payment?.status !== "Paid" &&
    !(await canBypassPosterPayment(req, id, tour))
  ) {
    res.status(403);
    throw new Error("Đăng ký cần hoàn tất thanh toán trước khi xem poster");
  }
  const templateSrc = getPosterTemplateSource(tour);
  if (!templateSrc) {
    res.status(400);
    throw new Error("Giải đấu chưa có ảnh mẫu poster");
  }

  const baseBuffer = await readImageBuffer(req, templateSrc);
  const meta = await sharp(baseBuffer).metadata();
  const width = meta.width || POSTER_BASE_W;
  const height = meta.height || POSTER_BASE_H;

  const players = [reg.player1, reg.player2].filter(Boolean);
  if (shouldRejectStalePosterAiLayout(tour, players.length)) {
    res.status(409);
    throw new Error(
      "Layout AI poster đã cũ hoặc thiếu mask crop ảnh/vùng vẽ tên/vùng xoá tên. Vui lòng bấm chạy lại AI poster để OpenAI phân tích lại khung ảnh và vùng tên.",
    );
  }
  const layout = resolvePosterLayout(tour, players.length, width, height);
  const templateRaw = await readPosterTemplateRaw(baseBuffer, width, height);
  const trustAiLayout = shouldTrustPosterAiLayout(tour, players.length);
  const avatarSlots = trustAiLayout
    ? await applyPosterAiTemplateMasks(layout.slots, width, height, templateRaw)
    : await refinePosterAvatarSlots(
        baseBuffer,
        layout.slots,
        width,
        height,
        templateRaw,
      );
  const slots = trustAiLayout
    ? avatarSlots
    : refinePosterNameSlots(avatarSlots, width, height, templateRaw);
  const avatarLayers = await Promise.all(
    players.map(async (player, idx) => {
      const slot = slots[idx]?.avatar;
      if (!slot) return null;
      return {
        input: await makeAvatarLayer(
          req,
          player,
          slot.width,
          slot.height,
          slot.radius,
          slot.mask,
          slot.clipPath,
          slot.safeInset,
        ),
        left: slot.left,
        top: slot.top,
      };
    }),
  );

  const textLayer = buildPosterTextSvg(
    width,
    height,
    players,
    slots,
    tour,
    layout,
    templateRaw,
  );
  const out = await sharp(baseBuffer)
    .resize(width, height, { fit: "fill" })
    .composite([
      ...avatarLayers.filter(Boolean),
      { input: textLayer, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();

  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.send(out);
});

export const getRegistrationPosterPlayers = asyncHandler(async (req, res) => {
  const { id, regId } = req.params;
  if (!isId(id) || !isId(regId)) {
    res.status(400);
    throw new Error("Invalid tournament or registration id");
  }

  const [tour, reg] = await Promise.all([
    Tournament.findById(id)
      .select("name eventType nameDisplayMode createdBy")
      .lean(),
    Registration.findOne({ _id: regId, tournament: id })
      .select("player1 player2 payment updatedAt")
      .populate("player1.user", POSTER_USER_SELECT)
      .populate("player2.user", POSTER_USER_SELECT)
      .lean(),
  ]);

  if (!tour || !reg) {
    res.status(404);
    throw new Error("Không tìm thấy đăng ký hoặc giải đấu");
  }
  if (
    reg.payment?.status !== "Paid" &&
    !(await canBypassPosterPayment(req, id, tour))
  ) {
    res.status(403);
    throw new Error("Đăng ký cần hoàn tất thanh toán trước khi xem poster");
  }

  const players = [reg.player1, reg.player2].filter(Boolean);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({
    registrationId: String(reg._id),
    players: players.map((player, index) =>
      buildPosterPlayerDebug(player, index, tour),
    ),
  });
});

export { getTournaments, getTournamentById };

export const listTournamentMatches = asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isId(id))
      return res.status(400).json({ message: "Invalid tournament id" });

    const view = String(req.query.view || "").trim().toLowerCase();
    if (view === "bracket") {
      return await listTournamentMatchesBracketView(req, res);
    }
    if (view === "schedule") {
      return await listTournamentMatchesScheduleView(req, res);
    }

    const {
      bracket,
      stage,
      type,
      status,
      court,
      hasCourt,
      courtStatus,
      page = 1,
      limit = 200000,
      sort = "round,order,createdAt",
    } = req.query;

    // ---- parse sort ----
    const parseSort = (s) =>
      String(s || "")
        .split(",")
        .reduce((acc, tok) => {
          const key = tok.trim();
          if (!key) return acc;
          acc[key.startsWith("-") ? key.slice(1) : key] = key.startsWith("-")
            ? -1
            : 1;
          return acc;
        }, {});
    const sortSpec = Object.keys(parseSort(sort)).length
      ? parseSort(sort)
      : { round: 1, order: 1, createdAt: 1 };

    // ---- base filter ----
    const filter = { tournament: id };
    if (status) filter.status = status;
    if (bracket && isId(bracket)) filter.bracket = bracket;

    if (
      (stage && Number.isFinite(Number(stage))) ||
      (type && typeof type === "string")
    ) {
      const bFilter = { tournament: id };
      if (stage) bFilter.stage = Number(stage);
      if (type) bFilter.type = type;
      const brs = await Bracket.find(bFilter).select("_id").lean();
      const ids = brs.map((b) => b._id);
      filter.bracket = filter.bracket
        ? { $in: ids.filter((x) => String(x) === String(filter.bracket)) }
        : { $in: ids };
    }

    // ---- court filters ----
    if (court && isId(court)) filter.court = court;
    if (hasCourt === "1" || hasCourt === "true") {
      filter.court = { $ne: null, ...(filter.court || {}) };
    }
    if (courtStatus) {
      const courtCond = { tournament: id };
      if (bracket && isId(bracket)) courtCond.bracket = bracket;
      const courts = await Court.find({ ...courtCond, status: courtStatus })
        .select("_id")
        .lean();
      const ids = courts.map((c) => c._id);
      if (filter.court && filter.court.$ne === null) {
        filter.court = { $in: ids };
      } else if (filter.court) {
        if (!ids.some((x) => String(x) === String(filter.court)))
          return res.json({ total: 0, page: 1, limit: 0, list: [] });
      } else {
        filter.court = { $in: ids };
      }
    }

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 1000);
    const skip = (pg - 1) * lim;

    // ---- fetch ----
    const [listRaw, total] = await Promise.all([
      Match.find(filter)
        .populate({
          path: "tournament",
          select: "name image eventType nameDisplayMode",
        })
        .populate({
          path: "bracket",
          // cần groups để map B từ pool/name/_id
          select:
            "name type stage order prefill ko meta config drawRounds groups._id groups.name",
        })
        .populate(MATCH_PAIR_POPULATE("pairA"))
        .populate(MATCH_PAIR_POPULATE("pairB"))
        .populate({ path: "previousA", select: "round order" })
        .populate({ path: "previousB", select: "round order" })
        .populate({ path: "referee", select: "name nickname" })
        .populate({
          path: "court",
          select: "name cluster status bracket order",
        })
        .populate({
          path: "courtStation",
          select: "name code status order clusterId",
        })
        .sort(sortSpec)
        .skip(lim ? skip : 0)
        .limit(lim || 0)
        .lean(),
      Match.countDocuments(filter),
    ]);

    // ---- stage buckets: Group = V1 cho toàn giải ----
    const allBrackets = await Bracket.find({ tournament: id })
      .select("_id type stage order prefill ko meta config drawRounds")
      .lean();

    // max round theo bracket (fallback khi thiếu config)
    const roundsAgg = await Match.aggregate([
      { $match: { tournament: toObjectId(id) } }, // dùng helper toObjectId của bạn
      { $group: { _id: "$bracket", maxRound: { $max: "$round" } } },
    ]);
    const maxRoundByBracket = new Map(
      roundsAgg.map((r) => [String(r._id), Number(r.maxRound) || 0])
    );

    const tkey = (t) => String(t || "").toLowerCase();
    const isGroupish = (t) => {
      const k = tkey(t);
      return k === "group" || k === "round_robin" || k === "gsl";
    };

    const teamsFromRoundKey = (k) => {
      if (!k) return 0;
      const up = String(k).toUpperCase();
      if (up === "F") return 2;
      if (up === "SF") return 4;
      if (up === "QF") return 8;
      const m = /^R(\d+)$/i.exec(up);
      return m ? parseInt(m[1], 10) : 0;
    };
    const ceilPow2 = (n) =>
      Math.pow(2, Math.ceil(Math.log2(Math.max(1, n || 1))));
    const readBracketScale = (br) => {
      const fromKey =
        teamsFromRoundKey(br?.ko?.startKey) ||
        teamsFromRoundKey(br?.prefill?.roundKey);
      const fromPrefillPairs = Array.isArray(br?.prefill?.pairs)
        ? br.prefill.pairs.length * 2
        : 0;
      const fromPrefillSeeds = Array.isArray(br?.prefill?.seeds)
        ? br.prefill.seeds.length * 2
        : 0;
      const cands = [
        br?.drawScale,
        br?.targetScale,
        br?.maxSlots,
        br?.capacity,
        br?.size,
        br?.scale,
        br?.meta?.drawSize,
        br?.meta?.scale,
        fromKey,
        fromPrefillPairs,
        fromPrefillSeeds,
      ]
        .map(Number)
        .filter((x) => Number.isFinite(x) && x >= 2);
      return cands.length ? ceilPow2(Math.max(...cands)) : 0;
    };
    const roundsCountForBracket = (br) => {
      const type = tkey(br?.type);
      const bid = String(br?._id || "");
      if (isGroupish(type)) return 1;

      // roundElim / playoff
      if (["roundelim", "po", "playoff"].includes(type)) {
        let k =
          Number(br?.meta?.maxRounds) ||
          Number(br?.config?.roundElim?.maxRounds) ||
          0;
        if (!k) k = maxRoundByBracket.get(bid) || 1;
        return Math.max(1, k);
      }

      // knockout / double_elim...
      const rFromMatches = maxRoundByBracket.get(bid) || 0;
      if (rFromMatches) return Math.max(1, rFromMatches);

      const firstPairs =
        (Array.isArray(br?.prefill?.seeds) && br.prefill.seeds.length) ||
        (Array.isArray(br?.prefill?.pairs) && br.prefill.pairs.length) ||
        0;
      if (firstPairs > 0) return Math.ceil(Math.log2(firstPairs * 2));

      const scale = readBracketScale(br);
      if (scale) return Math.ceil(Math.log2(scale));

      const drawRounds = Number(br?.drawRounds || 0);
      return drawRounds ? Math.max(1, drawRounds) : 1;
    };

    const groupBrs = allBrackets.filter((b) => isGroupish(b.type));
    const nonGroupBrs = allBrackets.filter((b) => !isGroupish(b.type));
    const stageVal = (b) =>
      Number.isFinite(b?.stage) ? Number(b.stage) : 9999;

    const buckets = [];
    if (groupBrs.length) {
      buckets.push({
        key: "group",
        isGroup: true,
        brs: groupBrs,
        spanRounds: 1, // cả vòng bảng = V1
        stageHint: 1,
        orderHint: Math.min(...groupBrs.map((b) => Number(b?.order ?? 0))),
      });
    }
    const byStage = new Map();
    for (const b of nonGroupBrs) {
      const s = stageVal(b);
      if (!byStage.has(s)) byStage.set(s, []);
      byStage.get(s).push(b);
    }
    const stageKeys = Array.from(byStage.keys()).sort((a, b) => a - b);
    for (const s of stageKeys) {
      const brs = byStage.get(s);
      const span = Math.max(...brs.map((b) => roundsCountForBracket(b))) || 1;
      buckets.push({
        key: `stage-${s}`,
        isGroup: false,
        brs,
        spanRounds: span,
        stageHint: s,
        orderHint: Math.min(...brs.map((b) => Number(b?.order ?? 0))),
      });
    }
    buckets.sort((a, b) => {
      if (a.isGroup && !b.isGroup) return -1;
      if (!a.isGroup && b.isGroup) return 1;
      if (a.stageHint !== b.stageHint) return a.stageHint - b.stageHint;
      return a.orderHint - b.orderHint;
    });

    const baseByBracketId = new Map();
    let acc = 0;
    for (const bucket of buckets) {
      for (const br of bucket.brs) baseByBracketId.set(String(br._id), acc);
      acc += bucket.spanRounds;
    }

    // ---- helpers build code ----
    const safeInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const alphaToNum = (s) => {
      const m = String(s || "")
        .trim()
        .match(/^[A-Za-z]/);
      if (!m) return undefined;
      return m[0].toUpperCase().charCodeAt(0) - 64; // A=1, B=2, ...
    };
    const getGroupNo = (m, br) => {
      // 1) từ pool.name hoặc pool.key
      const poolName = m?.pool?.name || m?.pool?.key || m?.groupCode || "";
      if (poolName) {
        const num = String(poolName).match(/\d+/);
        if (num) return parseInt(num[0], 10);
        const a = alphaToNum(poolName);
        if (a) return a;
      }
      // 2) map theo _id / name trong bracket.groups
      const groups = Array.isArray(br?.groups) ? br.groups : [];
      if (groups.length) {
        if (m?.pool?.id) {
          const i = groups.findIndex(
            (g) => String(g?._id) === String(m.pool.id)
          );
          if (i >= 0) return i + 1;
        }
        if (poolName) {
          const i = groups.findIndex(
            (g) =>
              String(g?.name || "")
                .trim()
                .toUpperCase() === String(poolName).trim().toUpperCase()
          );
          if (i >= 0) return i + 1;
        }
      }
      // 3) các field số trực tiếp
      const direct = [
        m?.groupNo,
        m?.groupIndex,
        m?.groupIdx,
        m?.group,
        m?.meta?.groupNo,
        m?.meta?.groupIndex,
        m?.meta?.pool,
        m?.group?.no,
        m?.group?.index,
        m?.group?.order,
        m?.pool?.index,
        m?.pool?.no,
        m?.pool?.order,
      ];
      for (const c of direct) {
        const n = safeInt(c);
        if (typeof n === "number") return n <= 0 ? 1 : n;
      }
      return undefined;
    };
    const getGroupT = (m) => {
      // ưu tiên labelKey: "...#N" (N 1-based)
      const lk = String(m?.labelKey || "");
      const mk = lk.match(/#(\d+)\s*$/);
      if (mk) return parseInt(mk[1], 10);

      const oig = safeInt(m?.orderInGroup) ?? safeInt(m?.meta?.orderInGroup);
      if (typeof oig === "number") return oig + 1;

      const ord = safeInt(m?.order);
      if (typeof ord === "number") return ord + 1;

      return 1;
    };
    const getNonGroupT = (m) => {
      const lk = String(m?.labelKey || "");
      const mk = lk.match(/#(\d+)\s*$/);
      if (mk) return parseInt(mk[1], 10);

      const ord =
        safeInt(m?.order) ??
        safeInt(m?.meta?.order) ??
        safeInt(m?.matchNo) ??
        safeInt(m?.index) ??
        0;
      return ord + 1;
    };

    const normalizedList = listRaw.map((rawMatch) =>
      normalizeMatchDisplayShape(rawMatch),
    );
    const matchesByBracketId = new Map();
    for (const match of normalizedList) {
      const bracketId = String(match?.bracket?._id || match?.bracket || "");
      if (!bracketId) continue;
      if (!matchesByBracketId.has(bracketId)) matchesByBracketId.set(bracketId, []);
      matchesByBracketId.get(bracketId).push(match);
    }
    await hydrateResolvedPairsInMatchList(normalizedList, {
      baseByBracketId,
      matchesByBracketId,
    });

    // ---- flatten + FINAL CODE ----
    const list = normalizedList.map((m) => {
      const br = m.bracket || {};
      const bid = String(br?._id || "");
      const groupStage = isGroupish(br?.type);

      const base = baseByBracketId.get(bid) ?? 0;
      const localRound = groupStage
        ? 1
        : Number.isFinite(m.round)
        ? m.round
        : 1;
      const globalRound = base + localRound; // KO ngay sau group => 2

      const codePayload = buildMatchCodePayload(m, {
        baseByBracketId,
        matchesByBracketId,
      });
      let displayCode = String(codePayload?.displayCode || "").trim();
      if (!displayCode) {
        if (groupStage) {
          const bNo = getGroupNo(m, br);
          const T = getGroupT(m);
          displayCode = `V1-${bNo ? `B${bNo}` : "B?"}-T${T}`;
        } else {
          const T = getNonGroupT(m);
          displayCode = `V${globalRound}-T${T}`;
        }
      }

      const globalCode = `V${globalRound}`;

      // phẳng court
      const courtId = m.courtStationId || m.courtStation?._id || m.courtStation || m.court?._id || m.court || null;
      const courtName =
        m.courtStationName || m.courtStationLabel || m.court?.name || m.courtLabel || "";
      const courtStatus = m.courtStation?.status || m.court?.status || "";
      const courtOrder = Number.isFinite(m.courtStation?.order)
        ? m.courtStation.order
        : Number.isFinite(m.court?.order)
        ? m.court.order
        : null;
      const courtBracket = m.court?.bracket || null;
      const courtCluster =
        m.courtClusterName ||
        m.courtClusterLabel ||
        m.court?.cluster ||
        m.courtCluster ||
        "";

      return {
        ...m,
        courtId,
        courtName,
        courtStatus,
        courtOrder,
        courtBracket,
        courtCluster,
        globalRound,
        globalCode, // "V1", "V2", ...
        code: displayCode,
        displayCode,
        codeResolved: displayCode,
        roundCode: displayCode,
      };
    });
    attachBackendResolvedSideNamesToMatches(list);

    setNoStoreHeaders(res);
    res.json({ total, page: pg, limit: lim, list });
  } catch (err) {
    next(err);
  }
});
export async function searchTournaments(req, res, next) {
  try {
    const q = (req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase(); // optional: upcoming/ongoing/finished
    const sportType = req.query.sportType; // optional
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const escapeRegex = (value = "") =>
      String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tokens = q.split(/\s+/).filter(Boolean).map(escapeRegex);

    const mongoQuery = {};
    if (sportType !== undefined && sportType !== "") {
      const sportTypeNumber = Number(sportType);
      if (Number.isFinite(sportTypeNumber)) {
        mongoQuery.sportType = sportTypeNumber;
      }
    }
    if (status) {
      mongoQuery.status = status;
    }
    if (tokens.length) {
      mongoQuery.$and = tokens.map((token) => ({
        $or: [
          { name: { $regex: token, $options: "i" } },
          { code: { $regex: token, $options: "i" } },
          { location: { $regex: token, $options: "i" } },
        ],
      }));
    }

    const rawRows = await Tournament.find(mongoQuery)
      .select(
        [
          "name",
          "code",
          "location",
          "status",
          "sportType",
          "groupId",
          "image",
          "eventType",
          "timezone",
          "regOpenDate",
          "registrationDeadline",
          "startDate",
          "endDate",
          "startAt",
          "endAt",
          "scoringScope",
          "locationGeo",
          "createdAt",
          "updatedAt",
          "finishedAt",
        ].join(" ")
      )
      .sort({ startAt: 1, createdAt: -1 })
      .limit(tokens.length ? limit * 4 : limit)
      .lean();

    const now = new Date();
    const computeRuntimeStatus = (tournament) => {
      if (tournament?.finishedAt) return "finished";
      const startInstant = tournament?.startAt || tournament?.startDate;
      const endInstant = tournament?.endAt || tournament?.endDate;
      if (startInstant && now < new Date(startInstant)) return "upcoming";
      if (endInstant && now > new Date(endInstant)) return "finished";
      return "ongoing";
    };
    const normalizedQuery = q.toLowerCase();
    const scoreTournament = (tournament) => {
      if (!normalizedQuery) return 0;
      const code = String(tournament?.code || "").toLowerCase();
      const name = String(tournament?.name || "").toLowerCase();
      const location = String(tournament?.location || "").toLowerCase();
      let score = 0;
      if (code === normalizedQuery) score += 200;
      if (name === normalizedQuery) score += 160;
      if (code.startsWith(normalizedQuery)) score += 100;
      if (name.startsWith(normalizedQuery)) score += 80;
      if (location.startsWith(normalizedQuery)) score += 40;
      if (code.includes(normalizedQuery)) score += 25;
      if (name.includes(normalizedQuery)) score += 20;
      if (location.includes(normalizedQuery)) score += 10;
      return score;
    };

    const filteredRows = rawRows
      .map((row) => ({
        ...row,
        status: computeRuntimeStatus(row),
        _searchScore: scoreTournament(row),
      }))
      .filter((row) => !status || row.status === status)
      .sort((a, b) => {
        if (b._searchScore !== a._searchScore) {
          return b._searchScore - a._searchScore;
        }
        const aStart = a.startAt ? new Date(a.startAt).getTime() : Number.MAX_SAFE_INTEGER;
        const bStart = b.startAt ? new Date(b.startAt).getTime() : Number.MAX_SAFE_INTEGER;
        if (aStart !== bStart) return aStart - bStart;
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .slice(0, limit);

    const items = await Promise.all(
      filteredRows.map(async ({ _searchScore, ...row }) =>
        normalizeTournamentPublicUrls(req, row)
      )
    );

    res.json({ items });
  } catch (err) {
    next(err);
  }
}
