import { Sponsor } from "../models/sponsorModel.js";

function parseBool(v) {
  if (v === undefined) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return ["1", "true", "yes", "on"].includes(s)
    ? true
    : ["0", "false", "no", "off"].includes(s)
    ? false
    : undefined;
}

function parseSort(sortStr = "weight:desc,createdAt:desc") {
  // vd: "weight:desc,createdAt:desc"
  const obj = {};
  sortStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((p) => {
      const [k, dir] = p.split(":");
      obj[k] = String(dir).toLowerCase() === "asc" ? 1 : -1;
    });
  return obj;
}

export async function adminListSponsors(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const {
      search = "",
      tier,
      sort = "weight:desc,createdAt:desc",
    } = req.query;
    const featured = parseBool(req.query.featured);

    const filter = {};
    if (search) filter.name = { $regex: search, $options: "i" };
    if (tier) filter.tier = tier;
    if (featured !== undefined) filter.featured = featured;

    const [items, total] = await Promise.all([
      Sponsor.find(filter).sort(parseSort(sort)).skip(skip).limit(limit),
      Sponsor.countDocuments(filter),
    ]);

    res.json({ items, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
}

export async function adminGetSponsor(req, res, next) {
  try {
    const item = await Sponsor.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Sponsor not found" });
    res.json(item);
  } catch (err) {
    next(err);
  }
}

function ensureUniqueSlug(baseSlug, existingSlugs) {
  if (!existingSlugs.has(baseSlug)) return baseSlug;
  let i = 2;
  while (existingSlugs.has(`${baseSlug}-${i}`)) i++;
  return `${baseSlug}-${i}`;
}

export async function adminCreateSponsor(req, res, next) {
  try {
    const {
      name,
      slug,
      logoUrl,
      websiteUrl,
      refLink,
      tier,
      description,
      featured,
      weight,
    } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });

    const baseSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slugs = new Set(
      (
        await Sponsor.find({ slug: new RegExp(`^${baseSlug}`) }).select("slug")
      ).map((x) => x.slug)
    );
    const finalSlug = ensureUniqueSlug(baseSlug, slugs);

    const doc = await Sponsor.create({
      name,
      slug: finalSlug,
      logoUrl,
      websiteUrl,
      refLink,
      tier,
      description,
      featured: !!featured,
      weight: Number.isFinite(+weight) ? +weight : 0,
    });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
}

export async function adminUpdateSponsor(req, res, next) {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const doc = await Sponsor.findById(id);
    if (!doc) return res.status(404).json({ message: "Sponsor not found" });

    const updatable = [
      "name",
      "logoUrl",
      "websiteUrl",
      "refLink",
      "tier",
      "description",
      "featured",
      "weight",
      "slug",
    ];
    updatable.forEach((k) => {
      if (body[k] !== undefined)
        doc[k] = k === "featured" ? !!body[k] : body[k];
    });

    if (body.slug) {
      const baseSlug = String(body.slug)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (baseSlug !== doc.slug) {
        const slugs = new Set(
          (
            await Sponsor.find({
              slug: new RegExp(`^${baseSlug}`),
              _id: { $ne: doc._id },
            }).select("slug")
          ).map((x) => x.slug)
        );
        doc.slug = ensureUniqueSlug(baseSlug, slugs);
      }
    }

    await doc.save();
    res.json(doc);
  } catch (err) {
    next(err);
  }
}

export async function adminDeleteSponsor(req, res, next) {
  try {
    const id = req.params.id;
    const r = await Sponsor.deleteOne({ _id: id });
    if (!r.deletedCount)
      return res.status(404).json({ message: "Sponsor not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function adminReorderSponsors(req, res, next) {
  try {
    const { orders } = req.body; // [{ id, weight }]
    if (!Array.isArray(orders))
      return res.status(400).json({ message: "orders must be an array" });

    const ops = orders
      .filter((o) => o && o.id !== undefined && Number.isFinite(+o.weight))
      .map((o) => ({
        updateOne: {
          filter: { _id: o.id },
          update: { $set: { weight: +o.weight } },
        },
      }));

    if (!ops.length) return res.json({ ok: true, updated: 0 });

    const r = await Sponsor.bulkWrite(ops);
    res.json({ ok: true, updated: r.modifiedCount || 0 });
  } catch (err) {
    next(err);
  }
}

// PUBLIC: trả về danh sách cho UI public (vd: trang landing/overlay)
export async function publicListSponsors(req, res, next) {
  try {
    const { tier, limit, featuredOnly } = req.query;
    const filter = {};
    if (tier) filter.tier = tier;
    if (parseBool(featuredOnly)) filter.featured = true;

    const q = Sponsor.find(filter).sort({ weight: -1, createdAt: -1 });
    if (limit) q.limit(Math.max(1, Math.min(200, parseInt(limit))));

    const items = await q.lean();
    res.json({ items });
  } catch (err) {
    next(err);
  }
}
