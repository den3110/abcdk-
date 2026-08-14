// controllers/sitemapController.js
// Sinh sitemap XML động cho Google crawler:
//   - /api/sitemap/index.xml      → sitemap-index root (trỏ tới các child)
//   - /api/sitemap/tournaments.xml → toàn bộ giải đấu công khai (isTest=false)
//   - /api/sitemap/clubs.xml       → toàn bộ CLB visibility=public
//
// Static home + list pages vẫn giữ ở frontend/public/sitemap.xml, nhưng
// từ nay sitemap-index sẽ là "1 điểm vào" duy nhất cho Google.

import Tournament from "../models/tournamentModel.js";
import Club from "../models/clubModel.js";

const SITE_URL = "https://pickletour.vn";

const escapeXml = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toIsoDate = (value) => {
  if (!value) return new Date().toISOString();
  try {
    return new Date(value).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

/**
 * Sitemap-index: 1 điểm vào duy nhất cho Google, list các child sitemap.
 * URL: GET /api/sitemap/index.xml
 */
export const getSitemapIndex = async (_req, res) => {
  const now = new Date().toISOString();
  const children = [
    { loc: `${SITE_URL}/sitemap-static.xml`, lastmod: now },
    { loc: `${SITE_URL}/api/sitemap/tournaments.xml`, lastmod: now },
    { loc: `${SITE_URL}/api/sitemap/clubs.xml`, lastmod: now },
    { loc: `${SITE_URL}/api/seo-news/sitemap.xml`, lastmod: now },
  ];
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    children
      .map(
        (c) =>
          `  <sitemap>\n    <loc>${escapeXml(c.loc)}</loc>\n    <lastmod>${c.lastmod}</lastmod>\n  </sitemap>`,
      )
      .join("\n") +
    "\n</sitemapindex>\n";
  res.set({
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600, s-maxage=3600",
  });
  return res.send(xml);
};

/**
 * Sitemap tournament: liệt kê mọi giải không phải test.
 * Cap 5000 URL/file (chuẩn sitemap protocol là 50k, nhưng 5k đủ dùng
 * và giảm rủi ro OOM). Sort mới nhất trước.
 * URL: GET /api/sitemap/tournaments.xml
 */
export const getSitemapTournaments = async (_req, res) => {
  try {
    const items = await Tournament.find({ isTest: { $ne: true } })
      .sort({ startDate: -1, createdAt: -1 })
      .limit(5000)
      .select("_id name updatedAt startDate endDate status")
      .lean();

    const now = new Date();
    const urls = items.map((t) => {
      const lastmod = toIsoDate(t.updatedAt || t.startDate);
      // Giải đã kết thúc → priority thấp; đang/upcoming → cao
      const priority = t.status === "finished" ? "0.4" : "0.8";
      const changefreq = t.status === "ongoing" ? "hourly" : "daily";
      return (
        `  <url>\n` +
        `    <loc>${SITE_URL}/tournament/${t._id}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>${changefreq}</changefreq>\n` +
        `    <priority>${priority}</priority>\n` +
        `  </url>`
      );
    });

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join("\n") +
      "\n</urlset>\n";
    res.set({
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Sitemap-Count": String(items.length),
      "X-Sitemap-Generated-At": now.toISOString(),
    });
    return res.send(xml);
  } catch (err) {
    console.error("[sitemap:tournaments] error:", err?.message || err);
    res.status(500).type("text/plain").send("Sitemap generation failed");
  }
};

/**
 * Sitemap club: liệt kê CLB visibility=public.
 * URL: GET /api/sitemap/clubs.xml
 */
export const getSitemapClubs = async (_req, res) => {
  try {
    const items = await Club.find({ visibility: "public" })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(5000)
      .select("_id slug name updatedAt")
      .lean();

    const now = new Date();
    const urls = items.map((c) => {
      const lastmod = toIsoDate(c.updatedAt);
      // Route mobile/web dùng /clubs/:id (theo main.jsx:262). Slug chỉ để
      // hiển thị URL đẹp trong tương lai — hiện tại dùng _id.
      return (
        `  <url>\n` +
        `    <loc>${SITE_URL}/clubs/${c._id}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>weekly</changefreq>\n` +
        `    <priority>0.6</priority>\n` +
        `  </url>`
      );
    });

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join("\n") +
      "\n</urlset>\n";
    res.set({
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Sitemap-Count": String(items.length),
      "X-Sitemap-Generated-At": now.toISOString(),
    });
    return res.send(xml);
  } catch (err) {
    console.error("[sitemap:clubs] error:", err?.message || err);
    res.status(500).type("text/plain").send("Sitemap generation failed");
  }
};
