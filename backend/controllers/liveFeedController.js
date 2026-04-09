import { listLiveFeed } from "../services/liveFeed.service.js";

function setNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-PKT-Cache", "BYPASS");
}

export async function getPublicLiveFeed(req, res) {
  try {
    setNoStoreHeaders(res);

    const payload = await listLiveFeed({
      q: req.query.q || req.query.keyword || "",
      tournamentId: req.query.tournamentId || "",
      mode: req.query.mode || "all",
      page: req.query.page || 1,
      limit: req.query.limit || 8,
    });

    setNoStoreHeaders(res);
    res.json(payload);
  } catch (error) {
    console.error("getPublicLiveFeed error:", error);
    res.status(500).json({ error: error.message });
  }
}
