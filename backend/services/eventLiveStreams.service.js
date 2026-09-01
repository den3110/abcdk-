// services/eventLiveStreams.service.js
// Tổng hợp live + video xem lại của 1 giải (vd Heineken Pickleball World Cup 2026)
// từ 1 kênh YouTube. Parse tiêu đề -> gom theo SÂN + GÓC CAM.
import { getSystemSettingsRuntime } from "./systemSettingsRuntime.service.js";
import { getCfgStr } from "./config.service.js";

const CACHE = { at: 0, data: null };
const CHANNEL_CACHE = new Map(); // channel(config) -> { channelId, uploads, at }
const TTL_MS = 90 * 1000;
const CHANNEL_TTL_MS = 6 * 3600 * 1000;

async function ytApi(path, params, apiKey) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.error?.errors?.[0]?.reason || json?.error?.message || `http_${res.status}`;
    const err = new Error(`youtube_${msg}`);
    err.detail = json?.error;
    throw err;
  }
  return json;
}

/** Parse "san5 / sân 5 / Sân D2 / court 3 - kitchen"
 *  -> { courtKey, courtLabel, courtSort, angle, angleLabel }. */
export function parseCourtAngle(rawTitle) {
  const title = String(rawTitle || "");
  const low = title.toLowerCase();

  // Bắt token sân: sau "san/sân/court", (tuỳ) 1-2 chữ + số. Vd: "5", "3", "D2".
  let courtKey = null;
  let courtLabel = "Khác";
  let courtSort = 100000;
  const m =
    low.match(/s[aâ]n\s*([a-zđ]{0,2})\s*0*(\d{1,3})/) ||
    low.match(/court\s*([a-z]{0,2})\s*0*(\d{1,3})/);
  if (m) {
    const letter = String(m[1] || "").toUpperCase();
    const num = parseInt(m[2], 10);
    if (Number.isFinite(num)) {
      courtKey = letter ? `${letter}${num}` : `${num}`;
      courtLabel = `Sân ${courtKey}`;
      // Sân số thuần xếp trước; sân có chữ (D2...) xếp sau, theo chữ rồi số.
      courtSort = letter ? 10000 + letter.charCodeAt(0) * 100 + num : num;
    }
  }

  // Sân có TÊN (không số): Grandstand / Championship / Center / Show court...
  // Các sân "show" này thường là sân chính nên xếp lên đầu.
  if (!courtKey) {
    const NAMED = [
      { re: /grand\s*stand|grandstand/, key: "GRANDSTAND", label: "Grandstand", sort: -20 },
      { re: /championship/, key: "CHAMPIONSHIP", label: "Championship", sort: -19 },
      { re: /cent(?:er|re)\s*court|trung t[aâ]m/, key: "CENTER", label: "Trung tâm", sort: -18 },
      { re: /show\s*court/, key: "SHOWCOURT", label: "Show Court", sort: -17 },
      { re: /stadium/, key: "STADIUM", label: "Stadium", sort: -16 },
    ];
    for (const n of NAMED) {
      if (n.re.test(low)) {
        courtKey = n.key;
        courtLabel = `Sân ${n.label}`;
        courtSort = n.sort;
        break;
      }
    }
  }

  let angle = "main";
  let angleLabel = "Toàn cảnh";
  if (/kitchen|\bnvz\b|non[-\s]?volley|vùng c[aâ]́?m|b[eế]p/.test(low)) {
    angle = "kitchen";
    angleLabel = "Kitchen (NVZ)";
  } else if (/baseline|cu[oố]i s[aâ]n|đ[aá]y s[aâ]n/.test(low)) {
    angle = "baseline";
    angleLabel = "Cuối sân";
  } else if (/overhead|tr[eê]n cao|g[oó]c cao|top[-\s]?down|bird|drone|fly/.test(low)) {
    angle = "overhead";
    angleLabel = "Trên cao";
  } else if (/side|b[eê]n h[oô]ng|g[oó]c b[eê]n/.test(low)) {
    angle = "side";
    angleLabel = "Bên hông";
  }

  return { courtKey, courtLabel, courtSort, angle, angleLabel };
}

const bestThumb = (sn) => {
  const t = sn?.thumbnails || {};
  return (
    t.maxres?.url || t.standard?.url || t.high?.url || t.medium?.url || t.default?.url || ""
  );
};

async function resolveChannel(channel, apiKey) {
  const raw = String(channel || "").trim();
  if (!raw) return null;

  const cached = CHANNEL_CACHE.get(raw);
  if (cached && Date.now() - cached.at < CHANNEL_TTL_MS) return cached;

  let result = null;
  // channelId trực tiếp (UC...)
  if (/^UC[\w-]{20,}$/.test(raw)) {
    const j = await ytApi(
      "channels",
      { part: "snippet,contentDetails", id: raw },
      apiKey,
    );
    const it = (j.items || [])[0];
    if (it) {
      result = {
        channelId: raw,
        uploads: it.contentDetails?.relatedPlaylists?.uploads || "",
        title: it.snippet?.title || "",
        at: Date.now(),
      };
    }
  } else {
    // handle (@name) hoặc "name"
    const handle = raw.startsWith("@")
      ? raw
      : "@" + raw.replace(/^https?:\/\/[^/]+\/@?/i, "").replace(/^@/, "");
    const j = await ytApi(
      "channels",
      { part: "snippet,id,contentDetails", forHandle: handle },
      apiKey,
    );
    const it = (j.items || [])[0];
    if (it) {
      result = {
        channelId: it.id,
        uploads: it.contentDetails?.relatedPlaylists?.uploads || "",
        title: it.snippet?.title || "",
        at: Date.now(),
      };
    }
  }

  if (result) CHANNEL_CACHE.set(raw, result);
  return result;
}

function groupByCourt(items, key) {
  const map = new Map();
  for (const it of items) {
    const k = it.courtKey != null ? `c:${it.courtKey}` : "other";
    if (!map.has(k))
      map.set(k, {
        courtKey: it.courtKey ?? null,
        courtLabel: it.courtLabel,
        courtSort: it.courtSort ?? 100000,
        [key]: [],
      });
    map.get(k)[key].push(it);
  }
  const groups = [...map.values()].sort(
    (a, b) => (a.courtSort ?? 1e9) - (b.courtSort ?? 1e9),
  );
  // Cùng 1 sân có nhiều feed cùng góc -> đánh số (Toàn cảnh 1, Toàn cảnh 2...)
  for (const g of groups) {
    const arr = g[key];
    const counts = {};
    arr.forEach((v) => (counts[v.angleLabel] = (counts[v.angleLabel] || 0) + 1));
    const seen = {};
    arr.forEach((v) => {
      if (counts[v.angleLabel] > 1) {
        seen[v.angleLabel] = (seen[v.angleLabel] || 0) + 1;
        v.angleLabelDisplay = `${v.angleLabel} ${seen[v.angleLabel]}`;
      } else {
        v.angleLabelDisplay = v.angleLabel;
      }
    });
  }
  return groups;
}

/** Parse cấu hình kênh (đa kênh). Mỗi kênh 1 dòng (hoặc ngăn bằng ";").
 *  Thêm "| tukhoa1, tukhoa2" để CHỈ lấy stream có tiêu đề chứa 1 trong các từ
 *  khoá đó (dùng cho kênh hỗn hợp như FPT Bóng Đá — chỉ lấy pickleball).
 *  Không có "|..." = lấy mọi live của kênh (kênh chuyên pickleball). */
export function parseChannelList(raw) {
  return String(raw || "")
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf("|");
      if (idx === -1) return { channel: line.trim(), keywords: [] };
      return {
        channel: line.slice(0, idx).trim(),
        keywords: line
          .slice(idx + 1)
          .split(",")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean),
      };
    })
    .filter((c) => c.channel);
}

function matchKeywords(title, keywords) {
  if (!keywords || !keywords.length) return true;
  const low = String(title || "").toLowerCase();
  return keywords.some((k) => low.includes(k));
}

/** Lấy live + replay của 1 kênh (đã áp bộ lọc từ khoá), gắn nhãn kênh nguồn. */
async function fetchOneChannel({ channel, keywords }, apiKey) {
  const ch = await resolveChannel(channel, apiKey);
  if (!ch?.channelId) return { live: [], replays: [] };

  const tag = (feed) => ({
    ...feed,
    channelId: ch.channelId,
    channelTitle: ch.title || "",
  });

  // Thu thập id ứng viên: (a) search eventType=live (khám phá live kể cả khi
  // uploads chưa kịp cập nhật), (b) uploads gần đây (cho replay + live search sót).
  const candidateIds = new Set();
  try {
    const j = await ytApi(
      "search",
      {
        part: "snippet",
        channelId: ch.channelId,
        eventType: "live",
        type: "video",
        maxResults: "25",
        order: "date",
      },
      apiKey,
    );
    for (const v of j.items || []) if (v.id?.videoId) candidateIds.add(v.id.videoId);
  } catch {
    /* vẫn tiếp tục */
  }
  if (ch.uploads) {
    try {
      const j = await ytApi(
        "playlistItems",
        { part: "contentDetails", playlistId: ch.uploads, maxResults: "50" },
        apiKey,
      );
      for (const it of j.items || []) {
        const vid = it.contentDetails?.videoId;
        if (vid) candidateIds.add(vid);
      }
    } catch {
      /* noop */
    }
  }
  if (!candidateIds.size) return { live: [], replays: [] };

  // videos.list: dùng snippet.liveBroadcastContent để phân loại CHÍNH XÁC
  // live vs xem lại (tránh stream đang live bị rơi sang tab Xem lại do search
  // trễ index), + status.embeddable trong cùng 1 call.
  const ids = [...candidateIds];
  const live = [];
  const replays = [];
  for (let i = 0; i < ids.length; i += 50) {
    let j;
    try {
      j = await ytApi(
        "videos",
        { part: "snippet,status", id: ids.slice(i, i + 50).join(",") },
        apiKey,
      );
    } catch {
      continue;
    }
    for (const v of j.items || []) {
      const sn = v.snippet || {};
      const title = sn.title || "";
      if (!matchKeywords(title, keywords)) continue;
      const feed = tag({
        videoId: v.id,
        title,
        thumbnail: bestThumb(sn),
        publishedAt: sn.publishedAt || null,
        embeddable: v.status?.embeddable !== false,
        ...parseCourtAngle(title),
      });
      const lbc = sn.liveBroadcastContent; // 'live' | 'upcoming' | 'none'
      if (lbc === "live") live.push(feed);
      else if (lbc !== "upcoming") replays.push(feed); // bỏ 'upcoming' (chưa phát)
    }
  }
  return { live, replays };
}

const dedupById = (arr) => {
  const seen = new Set();
  return arr.filter((f) => f.videoId && !seen.has(f.videoId) && seen.add(f.videoId));
};

export async function getEventLiveConfig() {
  let cfg = {};
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    cfg = settings?.eventLive || {};
  } catch {
    cfg = {};
  }
  return {
    enabled: cfg.enabled === true,
    eventName: cfg.eventName || "",
    eventLogoUrl: cfg.eventLogoUrl || "",
    bannerImageUrl: cfg.bannerImageUrl || "",
    tournamentId: cfg.tournamentId || "",
    youtubeChannel: cfg.youtubeChannel || "",
    _apiKey: cfg.youtubeApiKey || "",
  };
}

/** Dữ liệu cho client: { enabled, event..., live:[], replays:[] }. Cache 90s. */
export async function getEventLiveData({ force = false } = {}) {
  const now = Date.now();
  if (!force && CACHE.data && now - CACHE.at < TTL_MS) return CACHE.data;

  const cfg = await getEventLiveConfig();
  const base = {
    enabled: cfg.enabled,
    eventName: cfg.eventName,
    eventLogoUrl: cfg.eventLogoUrl,
    bannerImageUrl: cfg.bannerImageUrl,
    tournamentId: cfg.tournamentId,
    live: [],
    replays: [],
    updatedAt: new Date().toISOString(),
  };

  if (!cfg.enabled || !cfg.youtubeChannel) {
    CACHE.data = base;
    CACHE.at = now;
    return base;
  }

  const apiKey =
    (cfg._apiKey || "").trim() || (await getCfgStr("YOUTUBE_API_KEY", "")).trim();
  if (!apiKey) {
    base.error = "missing_api_key";
    CACHE.data = base;
    CACHE.at = now;
    return base;
  }

  try {
    const channels = parseChannelList(cfg.youtubeChannel);
    if (!channels.length) {
      base.error = "channel_not_found";
      CACHE.data = base;
      CACHE.at = now;
      return base;
    }

    // Lấy song song từng kênh; kênh lỗi thì bỏ qua (không làm hỏng cả trang).
    const results = await Promise.all(
      channels.map((c) =>
        fetchOneChannel(c, apiKey).catch(() => ({ live: [], replays: [] })),
      ),
    );

    let allLive = [];
    let allReplays = [];
    for (const r of results) {
      allLive.push(...(r.live || []));
      allReplays.push(...(r.replays || []));
    }

    allLive = dedupById(allLive);
    const liveSet = new Set(allLive.map((f) => f.videoId));
    allReplays = dedupById(allReplays.filter((f) => !liveSet.has(f.videoId)));

    base.live = groupByCourt(allLive, "angles");
    base.replays = groupByCourt(allReplays, "videos");
    base.updatedAt = new Date().toISOString();
  } catch (e) {
    base.error = e?.message || "yt_error";
  }

  CACHE.data = base;
  CACHE.at = now;
  return base;
}

export function invalidateEventLiveCache() {
  CACHE.at = 0;
  CACHE.data = null;
}
