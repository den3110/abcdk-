// backend/controllers/cmsController.js
import CmsBlock from "../models/cmsBlockModel.js";

const DEFAULTS = {
  hero: {
    title: "Kết nối cộng đồng & quản lý giải đấu thể thao",
    lead: "PickleTour giúp bạn đăng ký, tổ chức, theo dõi điểm trình và cập nhật bảng xếp hạng cho mọi môn thể thao – ngay trên điện thoại.",
    imageUrl: "/hero.jpg",
    imageAlt: "PickleTour — Kết nối cộng đồng & quản lý giải đấu",
  },
  contact: {
    address: "Abcd, abcd, abcd",
    phone: "012345678",
    email: "support@pickletour.vn",
    support: {
      generalEmail: "support@pickletour.vn",
      generalPhone: "0123456789",
      scoringEmail: "support@pickletour.vn",
      scoringPhone: "0123456789",
      salesEmail: "support@pickletour.vn",
    },
    socials: {
      facebook: "https://facebook.com",
      youtube: "https://youtube.com",
      zalo: "#",
    },
  },
};

// Deep merge đơn giản (không merge array)
function deepMerge(target = {}, src = {}) {
  const out = { ...target };
  for (const k of Object.keys(src)) {
    const sv = src[k];
    const tv = out[k];
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      out[k] = deepMerge(tv, sv);
    } else {
      out[k] = sv;
    }
  }
  return out;
}

function normalize(slug, doc) {
  if (!doc) return { slug, data: DEFAULTS[slug], updatedAt: null };
  return {
    slug,
    data: doc.data ?? DEFAULTS[slug],
    updatedAt: doc.updatedAt ?? null,
  };
}

async function getBlock(req, res, slug) {
  try {
    const doc = await CmsBlock.findOne({ slug }).lean();
    return res.json(normalize(slug, doc));
  } catch (err) {
    return res
      .status(500)
      .json({ message: err.message || "Internal Server Error" });
  }
}

async function updateBlock(req, res, slug) {
  try {
    const payload = req.body?.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res
        .status(400)
        .json({ message: "Invalid payload: 'data' must be an object" });
    }

    // Lấy current để deep-merge
    const current = await CmsBlock.findOne({ slug }).lean();
    const base = current?.data ?? DEFAULTS[slug] ?? {};
    const merged = deepMerge(base, payload);

    const updated = await CmsBlock.findOneAndUpdate(
      { slug },
      { $set: { data: merged, updatedBy: req.user?._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return res.json(normalize(slug, updated));
  } catch (err) {
    return res
      .status(500)
      .json({ message: err.message || "Internal Server Error" });
  }
}

/* ===== Exports ===== */
export const getHero = (req, res) => getBlock(req, res, "hero");
export const updateHero = (req, res) => updateBlock(req, res, "hero");

export const getContact = (req, res) => getBlock(req, res, "contact");
export const updateContact = (req, res) => updateBlock(req, res, "contact");
