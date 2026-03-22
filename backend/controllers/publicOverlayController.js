// controllers/publicOverlayController.js
// GET /api/public/overlay/config?limit=0&featured=1[&tier=Gold,Silver][&tournamentId=...|&tid=...]
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { Sponsor, SPONSOR_TIERS } from "../models/sponsorModel.js";
import CmsBlock from "../models/cmsBlockModel.js";
import Tournament from "../models/tournamentModel.js"; // ✅ NEW
import { CACHE_GROUP_IDS } from "../services/cacheGroups.js";
import { toPublicUrl } from "../utils/publicUrl.js";
import { createShortTtlCache } from "../utils/shortTtlCache.js";

const PUBLIC_OVERLAY_CONFIG_CACHE_TTL_MS = Math.max(
  10_000,
  Number(process.env.PUBLIC_OVERLAY_CONFIG_CACHE_TTL_MS || 30_000)
);
const publicOverlayConfigCache = createShortTtlCache(
  PUBLIC_OVERLAY_CONFIG_CACHE_TTL_MS,
  {
    id: CACHE_GROUP_IDS.publicOverlayConfig,
    label: "Public overlay config",
    category: "public",
    scope: "public",
  }
);

/* ---------- helpers ---------- */
const parseBoolQP = (v) => {
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return undefined;
};

const parseLimitQP = (v, def = 12, cap = 200) => {
  if (v == null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  if (n === 0) return 0; // 0 = no limit
  return Math.max(1, Math.min(cap, Math.floor(n)));
};

const normalizeTier = (name) => {
  if (!name) return null;
  const want = String(name).trim().toLowerCase();
  const found = SPONSOR_TIERS.find((t) => t.toLowerCase() === want);
  return found || null;
};

/* ---------- controller ---------- */
export const getOverlayConfig = asyncHandler(async (req, res) => {
  const limit = parseLimitQP(req.query.limit, 12, 200);
  const featured = parseBoolQP(req.query.featured);
  const tierQP = req.query.tier;

  const tidRaw = req.query.tournamentId || req.query.tid || null;
  const tid =
    tidRaw && mongoose.Types.ObjectId.isValid(tidRaw)
      ? new mongoose.Types.ObjectId(tidRaw)
      : null;
  const cacheKey = JSON.stringify({
    limit,
    featured: featured == null ? "" : featured,
    tier: String(tierQP || ""),
    tid: String(tid || ""),
  });
  const cached = publicOverlayConfigCache.get(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=30");
    res.setHeader("X-PKT-Cache", "HIT");
    return res.json(cached);
  }

  // Logo từ CMS (giữ nguyên như bạn đang làm)
  const FALLBACK_LOGO = "https://placehold.co/240x60/png?text=PickleTour";
  let webLogoUrl = FALLBACK_LOGO,
    webLogoAlt = "";

  try {
    const heroBlock = await CmsBlock.findOne({ slug: "hero" }).lean();
    if (heroBlock?.data) {
      webLogoUrl = heroBlock.data.overlayLogoUrl || FALLBACK_LOGO;
      webLogoAlt =
        heroBlock.data.overlayLogoAlt || heroBlock.data.imageAlt || "";
    }
  } catch {}

  // ✅ default: chưa có tid -> không có sponsors, không có ảnh giải
  if (!tid) {
    const payload = {
      webLogoUrl: toPublicUrl(req, webLogoUrl, { absolute: false }),
      webLogoAlt,
      sponsors: [],
      tournamentImageUrl: null, // ✅ NEW
    };
    publicOverlayConfigCache.set(cacheKey, payload);
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=30");
    res.setHeader("X-PKT-Cache", "MISS");
    return res.json(payload);
  }

  // Có tid -> chỉ lấy sponsor gắn đúng giải + ảnh giải
  const filter = {};
  // if (featured !== undefined) filter.featured = featured;

  if (tierQP) {
    const tiers = String(tierQP).split(",").map(normalizeTier).filter(Boolean);
    if (tiers.length) filter.tier = { $in: tiers };
  }

  // ✅ lọc đúng field theo schema
  filter.tournaments = tid; // chỉ những sponsor có chứa tid

  const sponsorsQuery = Sponsor.find(filter)
    .select(
      "_id name slug logoUrl websiteUrl refLink tier weight featured tournaments updatedAt"
    )
    .sort({ featured: -1, weight: -1, updatedAt: -1, name: 1 });

  if (limit > 0) sponsorsQuery.limit(limit);

  // 🔁 chạy song song: lấy sponsors + thông tin giải
  const [sponsorsRaw, tournament] = await Promise.all([
    sponsorsQuery.lean(),
    Tournament.findById(tid).select("_id name image").lean(),
  ]);

  let sponsors = sponsorsRaw;
  let tournamentImageUrl = tournament?.image || null; // ✅ lấy ảnh giải

  sponsors = sponsors.map((s) => ({
    ...s,
    logoUrl: toPublicUrl(req, s.logoUrl, { absolute: false }),
    websiteUrl: toPublicUrl(req, s.websiteUrl, { absolute: false }),
    refLink: toPublicUrl(req, s.refLink, { absolute: false }),
  }));

  const payload = {
    webLogoUrl: toPublicUrl(req, webLogoUrl, { absolute: false }),
    webLogoAlt,
    tournamentImageUrl: toPublicUrl(req, tournamentImageUrl, {
      absolute: false,
    }),
    sponsors,
  };
  publicOverlayConfigCache.set(cacheKey, payload);
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=30");
  res.setHeader("X-PKT-Cache", "MISS");
  return res.json(payload);
});
