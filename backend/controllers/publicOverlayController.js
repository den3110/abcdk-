// controllers/publicOverlayController.js
// GET /api/public/overlay/config?limit=0&featured=1[&tier=Gold,Silver]
import asyncHandler from "express-async-handler";
import { Sponsor, SPONSOR_TIERS } from "../models/sponsorModel.js";

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
  const tierQP = req.query.tier; // e.g. "Gold,Silver"

  const filter = {};
  if (featured !== undefined) filter.featured = featured;

  if (tierQP) {
    const tiers = String(tierQP)
      .split(",")
      .map((s) => normalizeTier(s))
      .filter(Boolean);
    if (tiers.length) filter.tier = { $in: tiers };
  }

  const q = Sponsor.find(filter)
    .select("_id name slug logoUrl websiteUrl refLink tier weight featured")
    // Ưu tiên: featured → weight desc → updatedAt desc → name asc
    .sort({ featured: -1, weight: -1, updatedAt: -1, name: 1 });

  if (limit > 0) q.limit(limit);

  const sponsors = await q.lean();

  // Trả tạm webLogoUrl — bạn thay bằng cấu hình hệ thống khi cần
  const webLogoUrl = "https://placehold.co/240x60/png?text=PickleTour";

  // Cache nhẹ (CDN + browser)
  res.set("Cache-Control", "public, max-age=30, s-maxage=60");

  res.json({
    webLogoUrl,
    sponsors,
  });
});
