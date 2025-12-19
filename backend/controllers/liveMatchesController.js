// controllers/liveMatchesController.js
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";

export async function listLiveMatches(req, res) {
  try {
    const LIMIT = 20;

    /* ================== IGNORE ALL FE FILTERS ================== */
    // bỏ qua q.status, q.statuses, q.windowMs...

    const matchQuery = {
      // vẫn giữ điều kiện phải có facebook live
      $or: [
        { "facebookLive.permalink_url": { $exists: true, $ne: "" } },
        { "facebookLive.id": { $exists: true, $ne: "" } },
      ],
    };

    const rows = await Match.find(matchQuery)
      .populate({
        path: "pairA",
        populate: [
          { path: "player1.user", select: "name" },
          { path: "player2.user", select: "name" },
        ],
      })
      .populate({
        path: "pairB",
        populate: [
          { path: "player1.user", select: "name" },
          { path: "player2.user", select: "name" },
        ],
      })
      .sort({ updatedAt: -1 })
      .limit(LIMIT)
      .lean();

    if (!rows.length) {
      return res.json({
        count: 0,
        items: [],
        meta: {
          source: "match-only",
          filter: {
            hasFacebook: true,
            limit: LIMIT,
            note: "ignore FE filters; latest 20",
          },
          at: new Date().toISOString(),
        },
      });
    }

    /* ================== brackets ================== */
    const tourIds = [
      ...new Set(
        rows
          .map((m) => (m.tournament ? String(m.tournament) : null))
          .filter(Boolean)
      ),
    ];

    const allBrackets = await Bracket.find({
      tournament: { $in: tourIds },
    })
      .select("_id tournament type stage order meta")
      .lean();

    const bracketsByTour = {};
    for (const br of allBrackets) {
      const tid = String(br.tournament);
      if (!bracketsByTour[tid]) bracketsByTour[tid] = [];
      bracketsByTour[tid].push(br);
    }
    for (const tid of Object.keys(bracketsByTour)) {
      bracketsByTour[tid].sort((a, b) => {
        if (a.stage !== b.stage) return a.stage - b.stage;
        if (a.order !== b.order) return a.order - b.order;
        return String(a._id).localeCompare(String(b._id));
      });
    }

    const groupTypes = new Set(["group", "round_robin", "gsl"]);

    const effRounds = (br) => {
      if (groupTypes.has(br.type)) return 1;
      const mr = br?.meta?.maxRounds;
      if (Number.isFinite(mr) && mr > 0) return mr;
      return 1;
    };

    const letterToIndex = (s) => {
      if (!s) return null;
      const str = String(s).trim();
      const num = str.match(/(\d+)/);
      if (num) return Number(num[1]);
      const m = str.match(/([A-Za-z])$/);
      if (m) return m[1].toUpperCase().charCodeAt(0) - 64;
      return null;
    };

    const buildDisplayForMatch = (m) => {
      const tourId = m.tournament ? String(m.tournament) : "";
      const brId = m.bracket ? String(m.bracket) : "";
      const brs = bracketsByTour[tourId] || [];
      const curBracket = brs.find((x) => String(x._id) === brId);
      const isGroup = curBracket ? groupTypes.has(curBracket.type) : false;

      let vOffset = 0;
      for (const br of brs) {
        if (String(br._id) === brId) break;
        vOffset += effRounds(br);
      }

      const roundInBracket = Number(m.round) > 0 ? Number(m.round) : 1;
      const vIndex = isGroup ? vOffset + 1 : vOffset + roundInBracket;

      let bAlpha =
        m?.pool?.name || m?.pool?.key || (m?.pool?.id ? String(m.pool.id) : "");
      if (typeof bAlpha !== "string") bAlpha = String(bAlpha || "");

      let bIndex = Number.isFinite(Number(m?.pool?.order))
        ? Number(m.pool.order) + 1
        : Number.isFinite(Number(m?.pool?.index))
        ? Number(m.pool.index) + 1
        : null;

      if (!bIndex) {
        const fromName = letterToIndex(m?.pool?.name || m?.pool?.key);
        if (fromName) bIndex = fromName;
      }

      if (!bIndex && m?.pool?.id) {
        const uniqPoolIds = [];
        for (const r of rows) {
          if (String(r.tournament || "") !== tourId) continue;
          const pid = r?.pool?.id ? String(r.pool.id) : null;
          if (pid && !uniqPoolIds.includes(pid)) uniqPoolIds.push(pid);
        }
        const pos = uniqPoolIds.indexOf(String(m.pool.id));
        if (pos >= 0) bIndex = pos + 1;
      }

      if (isGroup && !bIndex) bIndex = 1;
      if (!isGroup) bIndex = null;

      let tIndex = (Number(m.order) || 0) + 1;
      if (isGroup) {
        const samePool = rows
          .filter((r) => {
            if (String(r.tournament || "") !== tourId) return false;
            if (String(r.bracket || "") !== brId) return false;
            if (m?.pool?.id)
              return String(r?.pool?.id || "") === String(m.pool.id);
            if (m?.pool?.name)
              return String(r?.pool?.name || "") === String(m.pool.name);
            return true;
          })
          .sort((a, b) => {
            const rrA = Number(a.rrRound) || 0;
            const rrB = Number(b.rrRound) || 0;
            if (rrA !== rrB) return rrA - rrB;
            const oA = Number(a.order) || 0;
            const oB = Number(b.order) || 0;
            if (oA !== oB) return oA - oB;
            return (
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            );
          });

        const idx = samePool.findIndex((r) => String(r._id) === String(m._id));
        if (idx >= 0) tIndex = idx + 1;
      }

      const displayCode = isGroup
        ? `V${vIndex}-B${bIndex}-T${tIndex}`
        : `V${vIndex}-T${tIndex}`;

      return { displayCode, vIndex, bIndex, tIndex, bKeyAlpha: bAlpha };
    };

    /* ================== build items ================== */
    const items = rows.map((m) => {
      const { displayCode, vIndex, bIndex, tIndex, bKeyAlpha } =
        buildDisplayForMatch(m);

      return {
        _id: m._id,
        tournament: m.tournament,
        bracket: m.bracket,
        court: m.court,
        courtLabel: m.courtLabel,
        status: m.status,
        currentGame: m.currentGame ?? 0,
        labelKey: m.labelKey,
        code: displayCode,
        displayCode,
        vIndex,
        bIndex,
        tIndex,
        bKeyAlpha,
        facebookLive: {
          id: m.facebookLive?.id ?? "",
          videoId: m.facebookLive?.videoId ?? "",
          pageId: m.facebookLive?.pageId ?? "",
          status: m.facebookLive?.status ?? "",
          permalink_url: m.facebookLive?.permalink_url ?? "",
          video_permalink_url: m.facebookLive?.video_permalink_url ?? "",
          watch_url: m.facebookLive?.watch_url ?? "",
          embed_html: m.facebookLive?.embed_html ?? "",
          embed_url: m.facebookLive?.embed_url ?? "",
        },
        pairA: m.pairA || null,
        pairB: m.pairB || null,
        gameScores: m.gameScores || [],
        updatedAt: m.updatedAt,
        createdAt: m.createdAt,
      };
    });

    res.json({
      count: items.length,
      items,
      meta: {
        source: "match-only",
        filter: {
          hasFacebook: true,
          limit: LIMIT,
          note: "ignore FE filters; latest 20",
        },
        at: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error("listLiveMatches error:", e);
    res.status(500).json({ error: e.message });
  }
}

export async function deleteLiveVideoForMatch(req, res) {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ message: "matchId is required" });
    }

    // Xoá toàn bộ facebookLive khỏi match
    const updated = await Match.findByIdAndUpdate(
      matchId,
      {
        $unset: {
          facebookLive: 1,
        },
      },
      {
        new: true, // trả về bản mới
      }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: "Match không tồn tại" });
    }

    return res.json({
      message: "Đã xoá thông tin video khỏi match",
      matchId: updated._id,
      facebookLive: updated.facebookLive || null,
    });
  } catch (e) {
    console.error("deleteLiveVideoForMatch error:", e);
    return res.status(500).json({ message: e.message || "Server error" });
  }
}
