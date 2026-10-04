// services/eventLiveStreams.service.js
// Tổng hợp live + video xem lại của 1 giải (vd Heineken Pickleball World Cup 2026)
// từ 1 kênh YouTube. Parse tiêu đề -> gom theo SÂN + GÓC CAM.
import { getSystemSettingsRuntime } from "./systemSettingsRuntime.service.js";
import { getCfgStr } from "./config.service.js";

const CACHE = new Map(); // slugKey -> { at, data } (mỗi giải 1 slot)
const CHANNEL_CACHE = new Map(); // channel(config) -> { channelId, uploads, at }
const TTL_MS = 90 * 1000;
const CHANNEL_TTL_MS = 6 * 3600 * 1000;

/** Chuẩn hoá chuỗi -> slug ổn định (bỏ dấu, thường hoá). */
const slugKey = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

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

/** Lấy tên CỤM SÂN (venue) đứng ngay trước "sân" trong tiêu đề.
 *  Vd "Tiên Sơn - Sân 3" -> "Tiên Sơn"; "Tuyên Sơn - Sân D1" -> "Tuyên Sơn".
 *  "san 1 - kitchen" / "Sân D2 · Đà Nẵng ·..." -> "" (không có venue đứng trước). */
function extractVenue(title, courtIdx) {
  let pre = String(title).slice(0, courtIdx);
  // Tách theo dấu phân cách phổ biến, lấy đoạn cuối cùng (gần "sân" nhất)
  const segs = pre
    .split(/[-:|·>–—]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let cand = segs.length ? segs[segs.length - 1] : "";
  cand = cand
    .replace(/[🔴▶️🎾🏆•]/gu, "")
    .replace(/tr[ựu]c ti[ếe]p/gi, "")
    .replace(/\blive\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  // Loại nếu là tên giải / ngày giờ (không phải venue)
  if (
    !cand ||
    cand.length < 2 ||
    cand.length > 30 ||
    !/[a-zà-ỹ]/i.test(cand) ||
    /heineken|pickleball|world\s*cup|\bpwc\b|ng[àa]y|bu[ổo]i|c[uú]p|202\d|\d{1,2}\/\d{1,2}/i.test(
      cand,
    )
  ) {
    return "";
  }
  return cand;
}

/** Parse "Tiên Sơn - Sân 3 (Kitchen)" / "san5" / "Sân D2"
 *  -> { courtKey, courtLabel, courtSort, venue, angle, angleLabel }. */
export function parseCourtAngle(rawTitle) {
  const title = String(rawTitle || "");
  const low = title.toLowerCase();

  // Bắt token sân: sau "san/sân/court", (tuỳ) 1-2 chữ + số. Vd: "5", "3", "D2".
  let courtKey = null;
  let courtLabel = "Khác";
  let courtSort = 100000;
  let venue = "";
  const m =
    low.match(/s[aâ]n\s*([a-zđ]{0,2})\s*0*(\d{1,3})/) ||
    low.match(/court\s*([a-z]{0,2})\s*0*(\d{1,3})/);
  if (m) {
    const letter = String(m[1] || "").toUpperCase();
    const num = parseInt(m[2], 10);
    if (Number.isFinite(num)) {
      const courtNum = letter ? `${letter}${num}` : `${num}`;
      venue = extractVenue(title, m.index);
      const vkey = venue ? venue.toUpperCase().replace(/\s+/g, "") : "";
      // KHÁC venue -> KHÁC sân (Tiên Sơn Sân 3 ≠ Tuyên Sơn Sân 3)
      courtKey = vkey ? `${vkey}:${courtNum}` : courtNum;
      courtLabel = venue ? `${venue} - Sân ${courtNum}` : `Sân ${courtNum}`;
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

  return { courtKey, courtLabel, courtSort, venue, angle, angleLabel };
}

/** Chuyển duration ISO 8601 của YouTube (vd "PT1H23M45S") -> số giây. 0 nếu không có/không hợp lệ (live). */
function parseIsoDuration(iso) {
  const s = String(iso || "");
  const m = s.match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const h = Number(m[1] || 0),
    mi = Number(m[2] || 0),
    se = Number(m[3] || 0);
  return h * 3600 + mi * 60 + se;
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
        venue: it.venue || "",
        [key]: [],
      });
    map.get(k)[key].push(it);
  }
  // Xếp: cụm sân (venue) trước, trong cụm xếp theo số sân. Venue rỗng lên đầu.
  const groups = [...map.values()].sort((a, b) => {
    const va = a.venue || "";
    const vb = b.venue || "";
    if (va !== vb) return va.localeCompare(vb, "vi");
    return (a.courtSort ?? 1e9) - (b.courtSort ?? 1e9);
  });
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
        { part: "snippet,status,contentDetails", id: ids.slice(i, i + 50).join(",") },
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
        durationSec: parseIsoDuration(v.contentDetails?.duration),
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

/** Chuẩn hoá 1 object cấu hình giải (dùng chung cho giải mặc định & giải trong events[]). */
function normalizeEventCfg(raw) {
  const cfg = raw || {};
  return {
    enabled: cfg.enabled === true,
    slug: slugKey(cfg.slug || ""),
    pinnedToHome: cfg.pinnedToHome !== false,
    eventName: cfg.eventName || "",
    eventLogoUrl: cfg.eventLogoUrl || "",
    bannerImageUrl: cfg.bannerImageUrl || "",
    tournamentId: cfg.tournamentId || "",
    youtubeChannel: cfg.youtubeChannel || "",
    autoNotify: cfg.autoNotify === true,
    autoNotifyCooldownMinutes: Number(cfg.autoNotifyCooldownMinutes) || 180,
    manualStreams: Array.isArray(cfg.manualStreams) ? cfg.manualStreams : [],
    replayTitleFilter: String(cfg.replayTitleFilter || "").trim(),
    _apiKey: cfg.youtubeApiKey || "",
  };
}

/** Một giải được xem là "có cấu hình" khi có kênh YouTube hoặc >=1 luồng thủ công. */
function isEventConfigured(cfg) {
  if (cfg?.youtubeChannel) return true;
  return (cfg?.manualStreams || []).some(
    (m) => m && m.enabled !== false && String(m.url || "").trim(),
  );
}

/** Đọc toàn bộ cấu hình event-live: giải mặc định + mảng giải phụ (events[]). */
async function getAllEventConfigs() {
  let root = {};
  try {
    const settings = await getSystemSettingsRuntime({ ensureDocument: true });
    root = settings?.eventLive || {};
  } catch {
    root = {};
  }
  const def = { ...normalizeEventCfg(root), __default: true };
  const extra = (Array.isArray(root.events) ? root.events : []).map((e) =>
    normalizeEventCfg(e),
  );
  return { def, extra, all: [def, ...extra] };
}

/** Cấu hình 1 giải theo slug. Không truyền slug -> giải mặc định (tương thích cũ).
 *  slug không khớp -> trả cấu hình "tắt" để client hiện trạng thái trống. */
export async function getEventLiveConfig(slug = "") {
  const want = slugKey(slug || "");
  const { def, all } = await getAllEventConfigs();
  if (!want) return def;
  const found = all.find((c) => c.slug && c.slug === want);
  if (found) return found;
  return { ...normalizeEventCfg({}), slug: want };
}

/** Danh sách giải để hiện banner trang chủ (web + mobile): bật + ghim + có cấu hình. */
export async function listHomeEvents() {
  const { all } = await getAllEventConfigs();
  return all
    .filter((c) => c.enabled && c.pinnedToHome && isEventConfigured(c))
    .map((c) => ({
      slug: c.slug || "",
      eventName: c.eventName || "",
      eventLogoUrl: c.eventLogoUrl || "",
      bannerImageUrl: c.bannerImageUrl || "",
      tournamentId: c.tournamentId || "",
      configured: true,
    }));
}

/** Các giải cần auto-notify (bật + autoNotify + có kênh YouTube). Dùng cho job. */
export async function getAutoNotifyEvents() {
  const { all } = await getAllEventConfigs();
  return all.filter((c) => c.enabled && c.autoNotify && c.youtubeChannel);
}

/** Dò nhanh & RẺ các luồng đang LIVE (chỉ playlistItems + videos.list, KHÔNG
 *  dùng search 100-quota) — dùng cho job auto-notify chạy định kỳ.
 *  @returns {Promise<{enabled, eventName, live:[{videoId,courtKey,courtLabel}]}>} */
export async function detectLiveNow(inputCfg = null) {
  const cfg = inputCfg || (await getEventLiveConfig());
  if (!cfg.enabled || !cfg.youtubeChannel) return { enabled: false, live: [] };
  const apiKey =
    (cfg._apiKey || "").trim() || (await getCfgStr("YOUTUBE_API_KEY", "")).trim();
  if (!apiKey) return { enabled: true, live: [], error: "missing_api_key" };

  const channels = parseChannelList(cfg.youtubeChannel);
  const all = [];
  const seen = new Set();
  for (const { channel, keywords } of channels) {
    try {
      const ch = await resolveChannel(channel, apiKey);
      if (!ch?.uploads) continue;
      const pl = await ytApi(
        "playlistItems",
        { part: "contentDetails", playlistId: ch.uploads, maxResults: "50" },
        apiKey,
      );
      const ids = (pl.items || [])
        .map((it) => it.contentDetails?.videoId)
        .filter(Boolean);
      for (let i = 0; i < ids.length; i += 50) {
        const j = await ytApi(
          "videos",
          { part: "snippet", id: ids.slice(i, i + 50).join(",") },
          apiKey,
        );
        for (const v of j.items || []) {
          const sn = v.snippet || {};
          if (sn.liveBroadcastContent !== "live") continue;
          if (!matchKeywords(sn.title || "", keywords)) continue;
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          const p = parseCourtAngle(sn.title);
          all.push({ videoId: v.id, courtKey: p.courtKey, courtLabel: p.courtLabel });
        }
      }
    } catch {
      /* bỏ qua kênh lỗi */
    }
  }
  return { enabled: true, eventName: cfg.eventName, live: all };
}

/** Chuẩn hoá 1 URL thành id ổn định (để React key & tracking). */
function hashUrl(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return `hls_${(h >>> 0).toString(36)}`;
}

/** Xây feed từ các luồng thủ công (HLS/URL) trong cấu hình. */
function buildManualFeeds(cfg) {
  const list = Array.isArray(cfg.manualStreams) ? cfg.manualStreams : [];
  const live = [];
  const replays = [];
  list.forEach((m, idx) => {
    const url = String(m?.url || "").trim();
    if (!url || m?.enabled === false) return;
    const courtLabel = String(m?.courtLabel || "").trim() || "Luồng thủ công";
    const angleLabel = String(m?.angleLabel || "").trim() || "Toàn cảnh";
    const isHls = /\.m3u8(\?|$)/i.test(url);
    const feed = {
      videoId: m?.id || hashUrl(url), // id tổng hợp (không phải YouTube)
      sourceType: isHls ? "hls" : "url",
      hlsUrl: url,
      title: String(m?.title || "").trim() || courtLabel,
      thumbnail: String(m?.thumbnail || "").trim() || null,
      publishedAt: null,
      embeddable: true,
      courtKey: `manual:${slugKey(courtLabel) || idx}`,
      courtLabel,
      courtSort: -1000 + idx, // hiển thị lên đầu (luồng chủ động thêm)
      venue: null,
      angle: "main",
      angleLabel,
    };
    if (String(m?.kind || "live") === "replay") replays.push(feed);
    else live.push(feed);
  });
  return { live, replays };
}

/** Dữ liệu cho client: { enabled, event..., live:[], replays:[] }. Cache 90s. */
export async function getEventLiveData({ force = false, slug = "" } = {}) {
  const key = slugKey(slug || "");
  const now = Date.now();
  const cached = CACHE.get(key);
  if (!force && cached && now - cached.at < TTL_MS)
    return await attachLiveMatchInfo(cached.data);

  const cfg = await getEventLiveConfig(slug);
  const base = {
    enabled: cfg.enabled,
    slug: cfg.slug || key,
    eventName: cfg.eventName,
    eventLogoUrl: cfg.eventLogoUrl,
    bannerImageUrl: cfg.bannerImageUrl,
    tournamentId: cfg.tournamentId,
    live: [],
    replays: [],
    updatedAt: new Date().toISOString(),
  };

  if (!cfg.enabled) {
    CACHE.set(key, { data: base, at: now });
    return await attachLiveMatchInfo(base);
  }

  // Luồng thủ công (HLS/URL) — luôn hiển thị khi bật, không phụ thuộc YouTube.
  const manual = buildManualFeeds(cfg);
  let allLive = [...manual.live];
  let allReplays = [...manual.replays];

  // Luồng YouTube (best-effort) — nếu có cấu hình kênh + apiKey.
  if (cfg.youtubeChannel) {
    const apiKey =
      (cfg._apiKey || "").trim() ||
      (await getCfgStr("YOUTUBE_API_KEY", "")).trim();
    if (!apiKey) {
      if (!allLive.length && !allReplays.length) base.error = "missing_api_key";
    } else {
      try {
        const channels = parseChannelList(cfg.youtubeChannel);
        if (channels.length) {
          const results = await Promise.all(
            channels.map((c) =>
              fetchOneChannel(c, apiKey).catch(() => ({ live: [], replays: [] })),
            ),
          );
          for (const r of results) {
            allLive.push(...(r.live || []).map((f) => ({ ...f, sourceType: "youtube" })));
            allReplays.push(...(r.replays || []).map((f) => ({ ...f, sourceType: "youtube" })));
          }
        } else if (!allLive.length && !allReplays.length) {
          base.error = "channel_not_found";
        }
      } catch (e) {
        if (!allLive.length && !allReplays.length) base.error = e?.message || "yt_error";
      }
    }
  }

  allLive = dedupById(allLive);
  const liveSet = new Set(allLive.map((f) => f.videoId));
  allReplays = dedupById(allReplays.filter((f) => !liveSet.has(f.videoId)));

  // Lọc "Xem lại" theo tên sân/tiêu đề (admin cấu hình): chỉ giữ video có title chứa
  // chuỗi lọc (không phân biệt hoa thường). Rỗng = giữ tất cả.
  const titleFilter = String(cfg.replayTitleFilter || "").trim().toLowerCase();
  if (titleFilter) {
    allReplays = allReplays.filter((f) => {
      const hay = `${f.title || ""} ${f.courtLabel || ""} ${f.venue || ""}`.toLowerCase();
      return hay.includes(titleFilter);
    });
  }

  base.live = groupByCourt(allLive, "angles");
  base.replays = groupByCourt(allReplays, "videos");
  base.updatedAt = new Date().toISOString();

  CACHE.set(key, { data: base, at: now });
  return await attachLiveMatchInfo(base);
}

/** Lấy token sân từ 1 nhãn ("The Riverside - Sân 1" -> "1"; "Sân D2" -> "D2"; "1" -> "1"). */
function courtNumKey(label) {
  const s = String(label || "").trim();
  if (!s) return "";
  let m =
    s.match(/s[aâ]n\s*([a-zđ]{0,3})\s*0*(\d{1,3})/i) ||
    s.match(/court\s*([a-z]{0,3})\s*0*(\d{1,3})/i) ||
    s.match(/^([a-z]{0,3})\s*0*(\d{1,3})$/i);
  if (!m) return "";
  const letter = String(m[1] || "").toUpperCase();
  const num = String(parseInt(m[2], 10));
  return `${letter}${num}`;
}

/** Số ván mỗi đội đã THẮNG (các ván trước ván hiện tại). */
function countGamesWon(gameScores, currentGame) {
  const gs = Array.isArray(gameScores) ? gameScores : [];
  const cg = Number.isInteger(currentGame) ? currentGame : Math.max(0, gs.length - 1);
  let a = 0,
    b = 0;
  for (let i = 0; i < cg && i < gs.length; i++) {
    const ga = Number(gs[i]?.a) || 0;
    const gb = Number(gs[i]?.b) || 0;
    if (ga > gb) a++;
    else if (gb > ga) b++;
  }
  return { a, b };
}

/** Thông tin trận đang LIVE theo SỐ SÂN cho 1 giải (fetch tươi, KHÔNG cache 90s
 *  như feed YouTube — để tỉ số luôn mới). Trả Map<courtKey, matchInfo>. */
async function fetchLiveMatchInfoByCourt(tournamentId) {
  const map = new Map();
  if (!tournamentId) return map;
  try {
    const { default: Match } = await import("../models/matchModel.js");
    const { toRealtimePublicMatchDTO } = await import("../socket/liveHandlers.js");
    const matches = await Match.find({
      tournament: tournamentId,
      status: "live",
    })
      .populate([
        { path: "pairA" },
        { path: "pairB" },
        { path: "bracket" },
        { path: "tournament" },
      ])
      .limit(64);
    for (const m of matches) {
      const key = courtNumKey(m?.courtLabel || "");
      if (!key || map.has(key)) continue;
      let dto;
      try {
        dto = await toRealtimePublicMatchDTO(m);
      } catch {
        continue;
      }
      if (!dto) continue;
      const gs = Array.isArray(dto.gameScores) ? dto.gameScores : [];
      const cg = Number.isInteger(dto.currentGame)
        ? dto.currentGame
        : Math.max(0, gs.length - 1);
      const cur = gs[cg] || gs[gs.length - 1] || { a: 0, b: 0 };
      const games = countGamesWon(gs, cg);
      map.set(key, {
        teamA: dto.teamAName || "Đội A",
        teamB: dto.teamBName || "Đội B",
        scoreA: Number(cur.a) || 0,
        scoreB: Number(cur.b) || 0,
        gamesA: games.a,
        gamesB: games.b,
        bestOf: Number(dto.rules?.bestOf) || 1,
        stageName: dto.stageName || "",
      });
    }
  } catch {
    /* DB lỗi → bỏ qua, overlay vẫn chạy */
  }
  return map;
}

/** Gắn thông tin trận đang live (tên VĐV + tỉ số + tên vòng) vào từng sân trong
 *  base.live. KHÔNG mutate object cache — trả bản sao. */
async function attachLiveMatchInfo(base) {
  if (!base || !base.enabled || !base.tournamentId) return base;
  const groups = Array.isArray(base.live) ? base.live : [];
  if (!groups.length) return base;
  const byCourt = await fetchLiveMatchInfoByCourt(base.tournamentId);
  if (!byCourt.size) return base;
  const live = groups.map((g) => {
    const key = courtNumKey(g.courtLabel);
    const mi = key ? byCourt.get(key) : null;
    return mi ? { ...g, match: mi } : g;
  });
  return { ...base, live };
}

export function invalidateEventLiveCache() {
  CACHE.clear();
}
