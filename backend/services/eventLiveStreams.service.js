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
    const j = await ytApi("channels", { part: "contentDetails", id: raw }, apiKey);
    const it = (j.items || [])[0];
    if (it) {
      result = {
        channelId: raw,
        uploads: it.contentDetails?.relatedPlaylists?.uploads || "",
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
      { part: "id,contentDetails", forHandle: handle },
      apiKey,
    );
    const it = (j.items || [])[0];
    if (it) {
      result = {
        channelId: it.id,
        uploads: it.contentDetails?.relatedPlaylists?.uploads || "",
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
    const ch = await resolveChannel(cfg.youtubeChannel, apiKey);
    if (!ch?.channelId) {
      base.error = "channel_not_found";
      CACHE.data = base;
      CACHE.at = now;
      return base;
    }

    // 1) LIVE (search eventType=live) — tốn 100 quota/call nên cache mạnh
    let liveItems = [];
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
      liveItems = (j.items || [])
        .map((v) => ({ videoId: v.id?.videoId, snippet: v.snippet }))
        .filter((v) => v.videoId);
    } catch (e) {
      // vẫn tiếp tục lấy replay
    }
    const liveIds = new Set(liveItems.map((v) => v.videoId));

    const liveParsed = liveItems.map((v) => {
      const p = parseCourtAngle(v.snippet?.title);
      return {
        videoId: v.videoId,
        title: v.snippet?.title || "",
        thumbnail: bestThumb(v.snippet),
        publishedAt: v.snippet?.publishedAt || null,
        ...p,
      };
    });

    // 2) XEM LẠI: playlistItems trên uploads (1 quota/call)
    let replayParsed = [];
    if (ch.uploads) {
      try {
        const j = await ytApi(
          "playlistItems",
          { part: "snippet,contentDetails", playlistId: ch.uploads, maxResults: "40" },
          apiKey,
        );
        replayParsed = (j.items || [])
          .map((it) => {
            const vid = it.contentDetails?.videoId || it.snippet?.resourceId?.videoId;
            return { vid, sn: it.snippet };
          })
          .filter((x) => x.vid && !liveIds.has(x.vid))
          .map((x) => {
            const p = parseCourtAngle(x.sn?.title);
            return {
              videoId: x.vid,
              title: x.sn?.title || "",
              thumbnail: bestThumb(x.sn),
              publishedAt: x.sn?.publishedAt || null,
              ...p,
            };
          });
      } catch (e) {
        /* noop */
      }
    }

    base.live = groupByCourt(liveParsed, "angles");
    base.replays = groupByCourt(replayParsed, "videos");
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
