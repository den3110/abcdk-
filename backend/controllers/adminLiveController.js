import expressAsyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";
import Bracket from "../models/bracketModel.js";

/* ================== POPULATE ================== */
const matchPop = [
  { path: "tournament", select: "name" },
  { path: "bracket", select: "name type stage order" }, // thêm order
  {
    path: "pairA",
    populate: [
      { path: "player1.user", select: "name nickname avatar" },
      { path: "player2.user", select: "name nickname avatar" },
    ],
  },
  {
    path: "pairB",
    populate: [
      { path: "player1.user", select: "name nickname avatar" },
      { path: "player2.user", select: "name nickname avatar" },
    ],
  },
  { path: "referee", select: "name nickname" },
  { path: "liveBy", select: "name email" },
];

/* ================== HELPERS: platform ================== */
function detectPlatformFromUrl(url = "") {
  const s = String(url || "").toLowerCase();
  if (!s) return null;
  if (s.includes("youtube.com") || s.includes("youtu.be")) return "youtube";
  if (s.includes("facebook.com")) return "facebook";
  if (s.includes("tiktok.com")) return "tiktok";
  if (s.startsWith("rtmp://") || s.startsWith("rtmps://")) return "rtmp";
  return "other";
}
function pick(v1, v2) {
  return v1 != null && v1 !== "" ? v1 : v2;
}
function normalizeStatus(s) {
  if (!s) return "";
  return String(s).toUpperCase();
}
function isFbLiveStatus(status) {
  const st = normalizeStatus(status);
  return ["LIVE", "LIVE_NOW", "STREAMING"].includes(st);
}
function isFbEndedStatus(status) {
  const st = normalizeStatus(status);
  return ["ENDED", "STOPPED", "FINISHED"].includes(st);
}

/* ================== HELPERS: mã trận v / b / t ================== */
const GROUPISH_TYPES = new Set(["group", "round_robin", "gsl"]);

function roundsInBracket(br) {
  // group-like = 1 vòng; KO/PO = meta.maxRounds -> drawRounds -> 1
  if (GROUPISH_TYPES.has(br.type)) return 1;
  return br?.meta?.maxRounds || br?.drawRounds || 1;
}

/** Gom sẵn danh sách bracket đã sort theo order cho mỗi giải */
async function buildBracketIndexByTournament(tournamentIds = []) {
  if (!tournamentIds.length) return new Map();
  const rows = await Bracket.find({ tournament: { $in: tournamentIds } })
    .select("_id tournament type order meta.maxRounds drawRounds")
    .sort({ tournament: 1, order: 1, _id: 1 })
    .lean();

  const map = new Map();
  for (const b of rows) {
    const key = String(b.tournament);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  return map;
}

/** Tính v cộng dồn cho 1 match, dựa vào danh sách bracket của giải */
function computeGlobalVForMatch(m, bracketListOfTournament = []) {
  const bracketId = String(m.bracket?._id || m.bracket);
  let acc = 0;
  for (const b of bracketListOfTournament) {
    if (String(b._id) === bracketId) {
      const localRound = GROUPISH_TYPES.has(b.type) ? 1 : m.round || 1;
      return acc + localRound;
    }
    acc += roundsInBracket(b);
  }
  // fallback
  return m.round || 1;
}

/** Render mã theo spec: KO/PO -> v-t ; Group-like -> v-b-t */
function renderNewMatchCode({ bracketType, poolName, order0, v }) {
  const t = (Number.isFinite(order0) ? order0 : 0) + 1; // 1-based
  if (GROUPISH_TYPES.has(bracketType)) {
    const b = poolName || "1";
    return `V${v}-B${b}-T${t}`;
  }
  return `V${v}-T${t}`;
}

/** Gán code mới (v[-b]-t) lên m (mutate object) */
function applyNewCodeOnMatch(m, bracketsOfTournament = []) {
  const v = computeGlobalVForMatch(m, bracketsOfTournament);
  const bracketType = m?.bracket?.type || m?.format; // populate có type
  const poolName = m?.pool?.name || null;
  m.code = renderNewMatchCode({
    bracketType,
    poolName,
    order0: m.order,
    v,
  });
  // (option) shortCode giống code mới
  m.shortCode = m.code;
}

/** Áp dụng code mới hàng loạt trước khi map DTO */
function applyNewCodeOnMatches(matches = [], bracketIndexByT = new Map()) {
  for (const m of matches) {
    const tKey = String(m?.tournament?._id || m.tournament);
    const list = bracketIndexByT.get(tKey) || [];
    applyNewCodeOnMatch(m, list);
  }
}

/* ================== HELPERS: extract outputs ================== */
function extractFacebookOutputsFromMatch(m) {
  const out = [];
  const fbLive = m?.facebookLive || {};
  const metaFb = m?.meta?.facebook || {};
  const metaFbLive = metaFb?.live || {};

  const pageId = pick(fbLive.pageId, metaFb.pageId);
  const pageName = pick(metaFb.pageName, pageId);
  const permalink = pick(metaFb.permalinkUrl, fbLive.permalink_url);
  const liveId = pick(fbLive.id, metaFbLive.id);
  const status = pick(fbLive.status, metaFbLive.status);

  if (pageId || permalink || liveId) {
    out.push({
      platform: "facebook",
      targetName: pageName || "Facebook Page",
      pageId,
      publicUrl: permalink || "",
      url: permalink || "",
      meta: { liveId, status },
    });
  }
  return out;
}
function extractYouTubeOutputsFromMatch(m) {
  const yt = m?.meta?.youtube || {};
  const url = yt.watchUrl || yt.url;
  if (!url) return [];
  return [
    {
      platform: "youtube",
      targetName: yt.channelName || yt.channelId || "YouTube",
      publicUrl: url,
      url,
      meta: { videoId: yt.videoId, status: yt?.live?.status },
    },
  ];
}
function extractOtherOutputsFromMatch(m) {
  const outputs = [];
  if (m.video) {
    const p = detectPlatformFromUrl(m.video);
    outputs.push({
      platform: p,
      targetName: "",
      publicUrl: m.video,
      url: m.video,
    });
  }
  const ttt = m?.meta?.tiktokLive || m?.meta?.tiktok || null;
  if (ttt?.url || ttt?.watchUrl) {
    outputs.push({
      platform: "tiktok",
      targetName: ttt.account || ttt.username || "TikTok",
      publicUrl: ttt.watchUrl || ttt.url,
      url: ttt.watchUrl || ttt.url,
    });
  }
  const rtmp = m?.meta?.rtmp || null;
  if (rtmp?.publicUrl || rtmp?.viewUrl || rtmp?.url) {
    outputs.push({
      platform: "rtmp",
      targetName: rtmp.targetName || rtmp.channel || "RTMP",
      publicUrl: rtmp.publicUrl || rtmp.viewUrl || "",
      viewUrl: rtmp.viewUrl || "",
      url: rtmp.url || rtmp.publicUrl || "",
    });
  }
  return outputs;
}

/* ================== DTO & filters ================== */
function toSessionDTO(m) {
  const outputs = [
    ...extractFacebookOutputsFromMatch(m),
    ...extractYouTubeOutputsFromMatch(m),
    ...extractOtherOutputsFromMatch(m),
  ];

  // unique by (platform,url)
  const seen = new Set();
  const uniqOutputs = outputs.filter((o) => {
    const key = `${o.platform}|${o.url || o.publicUrl || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    id: m._id,
    status: m.status,
    startedAt: m.startedAt,
    startedBy: m.liveBy || null,
    tournament: m.tournament,
    bracket: m.bracket,
    match: m, // m.code đã được thay bằng mã mới
    outputs: uniqOutputs,
  };
}

function isSessionLiveable(s) {
  if (!s || s.match?.status === "finished") return false;
  const outs = (s.outputs || []).filter(
    (o) => !!(o.publicUrl || o.viewUrl || o.url)
  );
  if (outs.length === 0) return false;
  for (const o of outs) {
    if (o.platform !== "facebook") return true;
    const st = normalizeStatus(o?.meta?.status);
    if (!isFbEndedStatus(st) && st !== "CREATED") return true;
  }
  return false;
}

function derivePagesLiveFromSessions(sessions = []) {
  const map = new Map(); // key: pageId | permalink
  for (const s of sessions) {
    for (const o of s.outputs || []) {
      if (o.platform !== "facebook") continue;
      const st = normalizeStatus(o?.meta?.status);
      if (!isFbLiveStatus(st)) continue;
      const key =
        o.pageId || o.publicUrl || o.url || Math.random().toString(36);
      if (!map.has(key)) {
        map.set(key, {
          pageId: o.pageId || null,
          pageName: o.targetName || "Facebook Page",
          permalink_url: o.publicUrl || o.url || "",
          liveIds: new Set(),
          matches: [],
        });
      }
      const rec = map.get(key);
      if (o?.meta?.liveId) rec.liveIds.add(o.meta.liveId);
      rec.matches.push({
        id: s.id,
        code: s.match?.code, // đã là mã mới
        tournament: s.tournament?.name,
        bracket: s.bracket?.name,
      });
    }
  }
  const pages = [];
  for (const v of map.values()) {
    pages.push({
      pageId: v.pageId,
      pageName: v.pageName,
      permalink_url: v.permalink_url,
      liveIds: [...v.liveIds],
      matchCount: v.matches.length,
      matches: v.matches,
    });
  }
  return pages;
}

/* ================== ROUTES ================== */
export const adminListLivePages = expressAsyncHandler(async (req, res) => {
  const filter = {
    status: { $ne: "finished" },
    $or: [
      { "facebookLive.id": { $type: "string" } },
      { "meta.facebook.live.id": { $exists: true } },
      { "meta.facebook.permalinkUrl": { $type: "string" } },
    ],
  };

  const matches = await Match.find(filter)
    .select(
      "code shortCode status tournament bracket round order pool.name facebookLive meta startedAt"
    )
    .populate([
      { path: "tournament", select: "name" },
      { path: "bracket", select: "name type order" },
    ])
    .lean();

  // Tính mã trận mới trước khi map DTO
  const tournamentIds = [
    ...new Set(matches.map((m) => String(m?.tournament?._id || m.tournament))),
  ];
  const bracketIndexByT = await buildBracketIndexByTournament(tournamentIds);
  applyNewCodeOnMatches(matches, bracketIndexByT);

  const sessions = matches
    .map((m) => toSessionDTO(m))
    .filter((s) => isSessionLiveable(s));
  const pagesLive = derivePagesLiveFromSessions(sessions);
  res.json({ items: pagesLive });
});

export const adminListLiveSessions = expressAsyncHandler(async (req, res) => {
  const {
    tournamentId,
    q,
    platform,
    limit = 200,
    includePages = "1",
  } = req.query;

  const filter = { status: { $ne: "finished" } };
  if (tournamentId) filter.tournament = tournamentId;

  const matches = await Match.find(filter)
    .select(
      "code shortCode status startedAt liveBy video tournament bracket pairA pairB referee facebookLive meta round order pool.name"
    )
    .populate(matchPop)
    .sort({ startedAt: -1, createdAt: -1 })
    .limit(Math.min(Number(limit) || 200, 500))
    .lean();

  // Tính mã trận mới (v[-b]-t) cho tất cả trận
  const tournamentIds = [
    ...new Set(matches.map((m) => String(m?.tournament?._id || m.tournament))),
  ];
  const bracketIndexByT = await buildBracketIndexByTournament(tournamentIds);
  applyNewCodeOnMatches(matches, bracketIndexByT);

  // Map → session DTO & giữ chỉ những session có stream
  let sessions = matches.map((m) => toSessionDTO(m));
  sessions = sessions.filter((s) => isSessionLiveable(s));

  // Keyword filtering
  if (q && q.trim()) {
    const kw = q.trim().toLowerCase();
    sessions = sessions.filter((s) => {
      const parts = [];
      parts.push(s.match?.code, s.match?.shortCode);
      parts.push(s.tournament?.name, s.bracket?.name);
      const a1 =
        s.match?.pairA?.player1?.user?.nickname ||
        s.match?.pairA?.player1?.user?.name;
      const a2 =
        s.match?.pairA?.player2?.user?.nickname ||
        s.match?.pairA?.player2?.user?.name;
      const b1 =
        s.match?.pairB?.player1?.user?.nickname ||
        s.match?.pairB?.player1?.user?.name;
      const b2 =
        s.match?.pairB?.player2?.user?.nickname ||
        s.match?.pairB?.player2?.user?.name;
      for (const o of s.outputs || [])
        parts.push(o.platform, o.targetName, o.pageId, o.publicUrl, o.url);
      const hay = parts.filter(Boolean).join(" ").toLowerCase();
      return hay.includes(kw);
    });
  }

  // Platform filter
  if (platform) {
    const list = String(platform)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (list.length) {
      sessions = sessions.filter((s) =>
        (s.outputs || []).some((o) => list.includes(o.platform))
      );
    }
  }

  let pagesLive = [];
  if (
    String(includePages) === "1" ||
    String(includePages).toLowerCase() === "true"
  ) {
    pagesLive = derivePagesLiveFromSessions(sessions);
  }

  res.status(200).json({ items: sessions, pagesLive });
});

export const adminGetLiveSession = expressAsyncHandler(async (req, res) => {
  const m = await Match.findById(req.params.id)
    .select(
      "code shortCode status startedAt liveBy video tournament bracket pairA pairB referee facebookLive meta round order pool.name"
    )
    .populate(matchPop)
    .lean();
  if (!m) return res.status(404).json({ message: "Không tìm thấy trận" });
  if (m.status === "finished")
    return res.status(400).json({ message: "Trận đã kết thúc" });

  // Gán mã mới cho 1 trận đơn lẻ
  const bracketIndexByT = await buildBracketIndexByTournament([
    String(m?.tournament?._id || m.tournament),
  ]);
  const list =
    bracketIndexByT.get(String(m?.tournament?._id || m.tournament)) || [];
  applyNewCodeOnMatch(m, list);

  const dto = toSessionDTO(m);
  if (!isSessionLiveable(dto))
    return res.status(404).json({ message: "Chưa có stream khả dụng" });
  res.status(200).json(dto);
});

export const adminStopLiveSession = expressAsyncHandler(async (req, res) => {
  const m = await Match.findById(req.params.id);
  if (!m) return res.status(404).json({ message: "Không tìm thấy trận" });

  const fb = m.facebookLive || {};
  fb.status = "ENDED";
  fb.secure_stream_url = "";
  fb.server_url = "";
  fb.stream_key = "";
  m.facebookLive = fb;
  await m.save();

  res.json({
    message: "Đã dừng live Facebook cho trận",
    id: m._id,
    facebook: fb,
  });
});
