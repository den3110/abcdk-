// controllers/publicOverlayController.js
// GET /api/public/overlay/config?limit=0&featured=1[&tier=Gold,Silver][&tournamentId=...|&tid=...]
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import { Sponsor, SPONSOR_TIERS } from "../models/sponsorModel.js";
import CmsBlock from "../models/cmsBlockModel.js";
import Tournament from "../models/tournamentModel.js"; // ✅ NEW

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

// ✅ chỉ ép https ở môi trường production
const FORCE_HTTPS = process.env.NODE_ENV === "production";

const ensureHttps = (url) => {
  if (!url) return url;
  const s = String(url).trim();
  if (!s) return s;

  // đã là https rồi thì giữ nguyên
  if (/^https:\/\//i.test(s)) return s;

  // http => https
  if (/^http:\/\//i.test(s)) {
    return s.replace(/^http:\/\//i, "https://");
  }

  // relative path (/uploads/...) thì kệ, để frontend/normalizeUrl xử lý
  return s;
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
    if (FORCE_HTTPS) {
      webLogoUrl = ensureHttps(webLogoUrl);
    }
    return res.json({
      webLogoUrl,
      webLogoAlt,
      sponsors: [],
      tournamentImageUrl: null, // ✅ NEW
    });
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

  // ✅ ép https cho sponsor khi chạy production
  if (FORCE_HTTPS) {
    webLogoUrl = ensureHttps(webLogoUrl);
    tournamentImageUrl = ensureHttps(tournamentImageUrl);

    sponsors = sponsors.map((s) => ({
      ...s,
      logoUrl: ensureHttps(s.logoUrl),
      websiteUrl: ensureHttps(s.websiteUrl),
      refLink: ensureHttps(s.refLink),
    }));
  }

  return res.json({
    webLogoUrl,
    webLogoAlt,
    tournamentImageUrl, // ✅ trả thêm về FE
    sponsors,
  });
});
