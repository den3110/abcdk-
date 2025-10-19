// controllers/liveMatchesController.js
// ✅ Mặc định STRICT verify + KHÔNG bắt buộc status=live
// Query hỗ trợ:
//   - windowMs (ms, default 8h)
//   - excludeFinished (true/false, default true)
//   - statuses (CSV: ví dụ "scheduled,queued,assigned,live")
//   - concurrency (default 4)

import {
  collectStreamCandidatesFromDB,
  verifyStrict,
} from "../services/liveMatches.service.js";

export async function listLiveMatches(req, res) {
  try {
    const q = req.query || {};
    const windowMs = Number(q.windowMs ?? 8 * 3600 * 1000);
    const excludeFinished = String(q.excludeFinished ?? "true") === "true";
    const concurrency = Number(q.concurrency ?? 4);

    let statuses = null;
    if (typeof q.statuses === "string" && q.statuses.trim().length) {
      statuses = q.statuses
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const candidates = await collectStreamCandidatesFromDB({
      windowMs,
      excludeFinished,
      statuses,
    });
    const verified = await verifyStrict(candidates, { concurrency });

    res.json({
      count: verified.length,
      items: verified,
      meta: {
        windowMs,
        excludeFinished,
        statuses: statuses || "(all except finished)",
        verifyMode: "strict",
      },
    });
  } catch (e) {
    console.error("listLiveMatches error:", e);
    res.status(500).json({ error: e.message });
  }
}
