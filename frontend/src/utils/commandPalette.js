const RECENT_STORAGE_KEY = "pickletour-command-palette-recent-v1";
const PINNED_STORAGE_KEY = "pickletour-command-palette-pinned-v1";
const USAGE_STORAGE_KEY = "pickletour-command-palette-usage-v1";
const MAX_RECENT_ITEMS = 8;
const MAX_PINNED_ITEMS = 12;
const MAX_USAGE_ITEMS = 80;
const MAX_USAGE_PATHS = 10;

export const COMMAND_SCOPE_PREFIXES = Object.freeze({
  ">": "actions",
  "/": "pages",
  "#": "tournaments",
  "!": "clubs",
  "?": "news",
  "@": "players",
});

function replaceVietnameseLetters(value) {
  return value.replace(/đ/g, "d").replace(/Đ/g, "d");
}

export function normalizeCommandText(value) {
  return replaceVietnameseLetters(String(value || ""))
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/#@!?\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactCommandText(value) {
  return normalizeCommandText(value).replace(/\s+/g, "");
}

export function tokenizeCommandText(value) {
  return normalizeCommandText(value).split(" ").filter(Boolean);
}

export function extractScopedQuery(rawQuery = "") {
  const trimmed = String(rawQuery || "").trimStart();
  const prefix = trimmed.charAt(0);
  const scope = COMMAND_SCOPE_PREFIXES[prefix] || null;

  return {
    prefix: scope ? prefix : "",
    scope,
    query: scope ? trimmed.slice(1).trim() : trimmed.trim(),
  };
}

function uniqueStrings(values = []) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => (Array.isArray(value) ? value : [value]))
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function createSearchIndex(item = {}) {
  const title = normalizeCommandText(item.title);
  const subtitle = normalizeCommandText(item.subtitle);
  const description = normalizeCommandText(item.description);
  const path = normalizeCommandText(item.path);
  const keywords = uniqueStrings([item.keywords, item.aliases]).map(
    normalizeCommandText,
  );
  const haystack = uniqueStrings([
    title,
    subtitle,
    description,
    path,
    ...keywords,
  ]).join(" ");

  return {
    title,
    compactTitle: compactCommandText(item.title),
    subtitle,
    description,
    keywords,
    haystack,
    compactHaystack: haystack.replace(/\s+/g, ""),
  };
}

export function preparePaletteItem(item = {}) {
  const next = {
    priority: 0,
    scope: "pages",
    ...item,
  };

  return {
    ...next,
    searchIndex: createSearchIndex(next),
  };
}

export function mergePaletteItems(...groups) {
  const map = new Map();

  groups.flat().forEach((item) => {
    if (!item?.id) return;
    if (!map.has(item.id)) {
      map.set(item.id, item);
      return;
    }

    const current = map.get(item.id);
    map.set(
      item.id,
      (item.priority || 0) >= (current.priority || 0) ? item : current,
    );
  });

  return Array.from(map.values());
}

export function scorePaletteItem(item, searchState) {
  const scope = searchState?.scope || null;
  const query = normalizeCommandText(searchState?.query);
  const tokens = Array.isArray(searchState?.tokens)
    ? searchState.tokens
    : tokenizeCommandText(query);

  if (scope && item.scope !== scope) {
    return Number.NEGATIVE_INFINITY;
  }

  if (!query) {
    return Number(item.priority || 0);
  }

  const index = item.searchIndex || createSearchIndex(item);
  const queryCompact = compactCommandText(query);
  const titleWords = index.title.split(" ").filter(Boolean);

  let score = Number(item.priority || 0);

  if (index.title === query) score += 260;
  if (index.compactTitle && index.compactTitle === queryCompact) score += 220;
  if (index.title.startsWith(query)) score += 180;
  else if (index.compactTitle.startsWith(queryCompact) && queryCompact) {
    score += 150;
  } else if (index.title.includes(query)) {
    score += 120;
  }

  if (index.subtitle.startsWith(query)) score += 72;
  else if (index.subtitle.includes(query)) score += 42;

  if (index.description.includes(query)) score += 28;
  if (index.compactHaystack.includes(queryCompact) && queryCompact) score += 18;

  let matchedTokens = 0;

  tokens.forEach((token) => {
    if (!token) return;

    let tokenScore = 0;

    if (titleWords.includes(token)) tokenScore = 72;
    else if (index.title.startsWith(token)) tokenScore = 62;
    else if (index.title.includes(token)) tokenScore = 48;
    else if (index.keywords.some((keyword) => keyword === token)) {
      tokenScore = 46;
    } else if (index.keywords.some((keyword) => keyword.includes(token))) {
      tokenScore = 32;
    } else if (index.subtitle.includes(token)) {
      tokenScore = 24;
    } else if (index.description.includes(token)) {
      tokenScore = 14;
    } else if (index.compactHaystack.includes(token)) {
      tokenScore = 10;
    }

    if (tokenScore > 0) matchedTokens += 1;
    score += tokenScore;
  });

  if (!matchedTokens) return Number.NEGATIVE_INFINITY;

  if (tokens.length > 1 && matchedTokens < Math.ceil(tokens.length / 2)) {
    return Number.NEGATIVE_INFINITY;
  }

  score -= (tokens.length - matchedTokens) * 22;

  if (item.isRecent) score += 18;
  if (item.isContextual) score += 22;
  if (item.scope === "actions") score += 8;

  return score;
}

export function rankPaletteItems(items = [], options = {}) {
  const scope = options.scope || null;
  const query = normalizeCommandText(options.query);
  const tokens = tokenizeCommandText(query);

  const prepared = items.map((item) =>
    item?.searchIndex ? item : preparePaletteItem(item),
  );

  return prepared
    .map((item) => ({
      item,
      score: scorePaletteItem(item, { scope, query, tokens }),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.item.priority || 0) !== (a.item.priority || 0)) {
        return (b.item.priority || 0) - (a.item.priority || 0);
      }
      return String(a.item.title || "").localeCompare(String(b.item.title || ""));
    })
    .map(({ item }) => item);
}

export function sortPaletteItems(items = []) {
  return [...items].sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) {
      return (b.priority || 0) - (a.priority || 0);
    }
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function sanitizeStoredItem(item = {}) {
  if (!item?.id || !item?.title) return null;

  return {
    id: String(item.id),
    scope: String(item.scope || "pages"),
    title: String(item.title || ""),
    subtitle: String(item.subtitle || ""),
    description: String(item.description || ""),
    path: String(item.path || ""),
    iconKey: String(item.iconKey || ""),
    priority: Number(item.priority || 0),
    keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 12) : [],
    aliases: Array.isArray(item.aliases) ? item.aliases.slice(0, 12) : [],
    meta: item.meta && typeof item.meta === "object" ? item.meta : {},
    savedAt: Date.now(),
  };
}

export function readRecentPaletteItems() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeStoredItem).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeRecentPaletteItem(item) {
  if (typeof window === "undefined") return;

  const snapshot = sanitizeStoredItem(item);
  if (!snapshot) return;

  const current = readRecentPaletteItems().filter(
    (entry) => entry.id !== snapshot.id,
  );
  const next = [snapshot, ...current].slice(0, MAX_RECENT_ITEMS);

  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

export function clearRecentPaletteItems() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(RECENT_STORAGE_KEY);
}

export function readPinnedPaletteItems() {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(PINNED_STORAGE_KEY);
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeStoredItem).filter(Boolean);
  } catch {
    return [];
  }
}

export function writePinnedPaletteItem(item) {
  if (typeof window === "undefined") return;

  const snapshot = sanitizeStoredItem(item);
  if (!snapshot) return;

  const current = readPinnedPaletteItems().filter(
    (entry) => entry.id !== snapshot.id,
  );
  const next = [snapshot, ...current].slice(0, MAX_PINNED_ITEMS);

  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

export function removePinnedPaletteItem(itemId) {
  if (typeof window === "undefined") return;

  const next = readPinnedPaletteItems().filter(
    (entry) => entry.id !== String(itemId || ""),
  );

  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

export function clearPinnedPaletteItems() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PINNED_STORAGE_KEY);
}

function sanitizeCountMap(value, limit) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [String(key), Number(count || 0)])
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit),
  );
}

function sanitizeUsageMemory(value) {
  if (!value || typeof value !== "object") return { items: {} };

  const rawItems = value.items && typeof value.items === "object" ? value.items : {};

  return {
    items: Object.fromEntries(
      Object.entries(rawItems)
        .map(([itemId, item]) => {
          if (!itemId || !item || typeof item !== "object") return null;

          return [
            String(itemId),
            {
              count: Number(item.count || 0),
              lastUsedAt: Number(item.lastUsedAt || 0),
              paths: sanitizeCountMap(item.paths, MAX_USAGE_PATHS),
              dayparts: sanitizeCountMap(item.dayparts, 8),
            },
          ];
        })
        .filter((entry) => entry && entry[1].count > 0)
        .sort((a, b) => (b[1].lastUsedAt || 0) - (a[1].lastUsedAt || 0))
        .slice(0, MAX_USAGE_ITEMS),
    ),
  };
}

export function readPaletteUsageMemory() {
  if (typeof window === "undefined") return { items: {} };

  try {
    const raw = window.localStorage.getItem(USAGE_STORAGE_KEY);
    return sanitizeUsageMemory(JSON.parse(raw || "{}"));
  } catch {
    return { items: {} };
  }
}

function writePaletteUsageMemory(memory) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      USAGE_STORAGE_KEY,
      JSON.stringify(sanitizeUsageMemory(memory)),
    );
  } catch {
    // Ignore storage quota or privacy-mode failures.
  }
}

export function getPaletteUsageDaypart(date = new Date()) {
  const hour = date instanceof Date ? date.getHours() : new Date().getHours();

  if (hour < 5) return "lateNight";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

export function recordPaletteItemUsage(item, context = {}) {
  if (typeof window === "undefined" || !item?.id) return readPaletteUsageMemory();

  const memory = readPaletteUsageMemory();
  const itemId = String(item.id);
  const path = String(context.path || "").trim();
  const daypart = String(context.daypart || "").trim();
  const current = memory.items[itemId] || {
    count: 0,
    lastUsedAt: 0,
    paths: {},
    dayparts: {},
  };

  const next = {
    ...memory,
    items: {
      ...memory.items,
      [itemId]: {
        count: Number(current.count || 0) + 1,
        lastUsedAt: Date.now(),
        paths: path
          ? {
              ...current.paths,
              [path]: Number(current.paths?.[path] || 0) + 1,
            }
          : current.paths || {},
        dayparts: daypart
          ? {
              ...current.dayparts,
              [daypart]: Number(current.dayparts?.[daypart] || 0) + 1,
            }
          : current.dayparts || {},
      },
    },
  };

  writePaletteUsageMemory(next);
  return sanitizeUsageMemory(next);
}

export function scorePalettePersonalization(item, memory, context = {}) {
  const itemId = String(item?.id || "");
  if (!itemId) {
    return {
      score: 0,
      totalCount: 0,
      pathCount: 0,
      daypartCount: 0,
      recentHit: false,
    };
  }

  const snapshot = memory?.items?.[itemId];
  if (!snapshot) {
    return {
      score: 0,
      totalCount: 0,
      pathCount: 0,
      daypartCount: 0,
      recentHit: false,
    };
  }

  const path = String(context.path || "").trim();
  const daypart = String(context.daypart || "").trim();
  const pathCount = path ? Number(snapshot.paths?.[path] || 0) : 0;
  const daypartCount = daypart ? Number(snapshot.dayparts?.[daypart] || 0) : 0;
  const totalCount = Number(snapshot.count || 0);
  const recentHit =
    Number(snapshot.lastUsedAt || 0) > 0 &&
    Date.now() - Number(snapshot.lastUsedAt || 0) < 1000 * 60 * 60 * 36;

  let score = Math.min(totalCount * 4, 28);
  score += Math.min(pathCount * 24, 120);
  score += Math.min(daypartCount * 8, 24);
  if (recentHit) score += 12;

  return {
    score,
    totalCount,
    pathCount,
    daypartCount,
    recentHit,
  };
}
