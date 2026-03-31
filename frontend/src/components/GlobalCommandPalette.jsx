import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  alpha,
  Box,
  Chip,
  Dialog,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ClearRounded,
  KeyboardCommandKeyRounded,
  SearchRounded,
} from "@mui/icons-material";
import { toast } from "react-toastify";
import { useLocation, useNavigate } from "react-router-dom";

import { logout } from "../slices/authSlice";
import {
  useLazySearchUserQuery,
  useLogoutMutation,
} from "../slices/usersApiSlice";
import { useLazyAssistCommandPaletteQuery } from "../slices/commandPaletteApiSlice.js";
import {
  useGetTournamentQuery,
  useLazySearchTournamentsQuery,
  useListMyTournamentsQuery,
  useListTournamentsQuery,
} from "../slices/tournamentsApiSlice";
import { useGetSeoNewsListQuery } from "../slices/seoNewsApiSlice";
import { useGetClubQuery, useListClubsQuery } from "../slices/clubsApiSlice";
import { useThemeMode } from "../context/ThemeContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useCommandPalette } from "../context/CommandPaletteContext.jsx";
import {
  clearPinnedPaletteItems,
  clearRecentPaletteItems,
  extractScopedQuery,
  getPaletteUsageDaypart,
  mergePaletteItems,
  normalizeCommandText,
  preparePaletteItem,
  readPinnedPaletteItems,
  readPaletteUsageMemory,
  rankPaletteItems,
  recordPaletteItemUsage,
  removePinnedPaletteItem,
  scorePalettePersonalization,
  readRecentPaletteItems,
  sortPaletteItems,
  writePinnedPaletteItem,
  writeRecentPaletteItem,
} from "../utils/commandPalette.js";
import {
  buildCommandPaletteContextSummary,
  matchCommandPaletteRecipe,
} from "../utils/commandPaletteRecipes.js";
import PaletteOperatorStrip from "./commandPalette/PaletteOperatorStrip.jsx";
import PaletteResultsPane from "./commandPalette/PaletteResultsPane.jsx";
import PaletteSearchInput from "./commandPalette/PaletteSearchInput.jsx";

const REMOTE_SEARCH_DEBOUNCE_MS = 220;
const AI_ASSIST_IDLE_MS = 720;
const AI_ASSIST_MIN_QUERY_LENGTH = 3;
const AI_CANDIDATE_LIMIT = 24;
const INPUT_COMMIT_DEBOUNCE_MS = 140;
const RESULT_LIMIT = 16;
const DISCOVERY_LIMIT = 4;

const SCOPE_OPTIONS = [
  { value: "all", prefix: "" },
  { value: "actions", prefix: ">" },
  { value: "pages", prefix: "/" },
  { value: "tournaments", prefix: "#" },
  { value: "clubs", prefix: "!" },
  { value: "news", prefix: "?" },
  { value: "players", prefix: "@" },
];

function sid(value) {
  return String(value?._id || value?.id || value?.slug || value || "");
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isAdminUser(user) {
  if (!user) return false;

  const roles = new Set(
    Array.isArray(user?.roles) ? user.roles.map(normalizeRole) : [],
  );

  if (user?.role) roles.add(normalizeRole(user.role));
  if (user?.isAdmin === true) roles.add("admin");

  return roles.has("admin");
}

function getTournamentIdFromPath(pathname) {
  const match = String(pathname || "").match(/^\/tournament\/([^/]+)/);
  return match?.[1] || "";
}

function getClubIdFromPath(pathname) {
  const match = String(pathname || "").match(/^\/clubs\/([^/]+)/);
  return match?.[1] || "";
}

function safeArray(value, fallbackKey) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[fallbackKey])) return value[fallbackKey];
  return [];
}

function formatShortDate(value, locale) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString(locale || "vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

async function copyTextToClipboard(value) {
  const nextValue = String(value || "").trim();
  if (!nextValue || typeof window === "undefined") return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(nextValue);
      return true;
    }
  } catch {
    // Fallback below.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = nextValue;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function toAbsoluteUrl(path) {
  if (!path || typeof window === "undefined") return "";

  try {
    return new URL(String(path), window.location.origin).toString();
  } catch {
    return "";
  }
}

function normalizeMathExpression(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const withoutPrefix = raw.startsWith("=") ? raw.slice(1).trim() : raw;
  const normalized = withoutPrefix
    .replace(/[x×]/gi, "*")
    .replace(/[÷:]/g, "/")
    .replace(/,/g, ".");

  if (!/[0-9]/.test(normalized)) return "";
  if (!/^[0-9+\-*/().%\s]+$/.test(normalized)) return "";
  return normalized.trim();
}

function evaluateMathExpression(value) {
  const expression = normalizeMathExpression(value);
  if (!expression) return null;

  try {
    const safeExpression = expression.replace(
      /(\d+(?:\.\d+)?)%/g,
      "($1/100)",
    );
    const result = Function(
      `"use strict"; return (${safeExpression});`,
    )();

    if (!Number.isFinite(result)) return null;

    return {
      expression,
      result: Math.round((result + Number.EPSILON) * 1000000) / 1000000,
    };
  } catch {
    return null;
  }
}

function formatMathResult(value, locale) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";

  return new Intl.NumberFormat(locale || "vi-VN", {
    maximumFractionDigits: 6,
  }).format(number);
}

function createPaletteItem(config) {
  return preparePaletteItem(config);
}

function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function hasMeaningfulAssistResult(result) {
  if (!result || typeof result !== "object") return false;

  return Boolean(
    result.primaryId ||
      (Array.isArray(result.topIds) && result.topIds.length) ||
      (Array.isArray(result.planIds) && result.planIds.length) ||
      result.queryRewrite ||
      result.suggestedScope ||
      result.reason ||
      result.operatorTitle ||
      result.operatorHint ||
      result.clarifyQuestion ||
      (Array.isArray(result.clarifyChoices) && result.clarifyChoices.length) ||
      (Array.isArray(result.suggestedPrompts) && result.suggestedPrompts.length),
  );
}

export default function GlobalCommandPalette() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const { open, closePalette } = useCommandPalette();
  const { t, locale, language, setLanguage } = useLanguage();
  const { toggleTheme, isDark } = useThemeMode();

  const userInfo = useSelector((state) => state.auth?.userInfo || null);
  const hasUserInfo = Boolean(userInfo?._id || userInfo?.token || userInfo?.email);
  const isAdmin = isAdminUser(userInfo);

  const [logoutApiCall] = useLogoutMutation();
  const [searchTournaments, tournamentSearchState] =
    useLazySearchTournamentsQuery();
  const [searchUsers, userSearchState] = useLazySearchUserQuery();
  const [triggerAiAssist, aiAssistState] = useLazyAssistCommandPaletteQuery();

  const [query, setQuery] = useState("");
  const [queryInputSyncKey, setQueryInputSyncKey] = useState(0);
  const [selectedScope, setSelectedScope] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [aiAssistResult, setAiAssistResult] = useState(null);
  const [aiAssistAvailable, setAiAssistAvailable] = useState(true);
  const [pinnedSnapshots, setPinnedSnapshots] = useState(() =>
    readPinnedPaletteItems(),
  );
  const [usageMemory, setUsageMemory] = useState(() => readPaletteUsageMemory());
  const [recentSnapshots, setRecentSnapshots] = useState(() =>
    readRecentPaletteItems(),
  );

  const deferredQuery = useDeferredValue(query);
  const debouncedAiQuery = useDebouncedValue(query, AI_ASSIST_IDLE_MS);
  const parsedQuery = useMemo(() => extractScopedQuery(deferredQuery), [deferredQuery]);
  const aiParsedQuery = useMemo(
    () => extractScopedQuery(debouncedAiQuery),
    [debouncedAiQuery],
  );
  const activeScope = parsedQuery.scope || selectedScope;
  const normalizedScope = activeScope === "all" ? null : activeScope;
  const searchText = parsedQuery.query;
  const aiActiveScope = aiParsedQuery.scope || selectedScope;
  const aiNormalizedScope = aiActiveScope === "all" ? null : aiActiveScope;
  const aiSearchText = aiParsedQuery.query;
  const isAiInputSettling = query !== debouncedAiQuery;
  const hasSearchIntent = Boolean(searchText) || Boolean(normalizedScope);

  const currentTournamentId = getTournamentIdFromPath(location.pathname);
  const currentClubId = getClubIdFromPath(location.pathname);
  const usageDaypart = getPaletteUsageDaypart();
  const currentPathKey = `${location.pathname}${location.search || ""}`;

  const inputRef = useRef(null);
  const resultsScrollRef = useRef(null);
  const itemRefs = useRef({});
  const remoteSearchKeyRef = useRef("");
  const aiSearchKeyRef = useRef("");
  const aiRequestRef = useRef(null);
  const listScrollSettleRef = useRef(null);
  const isListScrollingRef = useRef(false);
  const keyboardNavigationRef = useRef(false);

  const { data: listTournaments = [] } = useListTournamentsQuery(
    { limit: 18, sort: "-updatedAt" },
    { skip: !open },
  );
  const { data: myTournamentsData } = useListMyTournamentsQuery(
    { page: 1, limit: 10, withMatches: 0 },
    { skip: !open || !hasUserInfo },
  );
  const { data: clubsData } = useListClubsQuery(
    { limit: 14 },
    { skip: !open },
  );
  const { data: newsData } = useGetSeoNewsListQuery(
    { page: 1, limit: 12 },
    { skip: !open },
  );
  const { data: currentTournament } = useGetTournamentQuery(currentTournamentId, {
    skip: !open || !currentTournamentId,
  });
  const { data: currentClub } = useGetClubQuery(currentClubId, {
    skip: !open || !currentClubId,
  });
  const contextSummary = useMemo(
    () =>
      buildCommandPaletteContextSummary({
        pathname: location.pathname,
        search: location.search,
        currentTournamentId,
        currentTournamentName: currentTournament?.name,
        currentClubId,
        currentClubName: currentClub?.name,
        isAdmin,
        hasUserInfo,
      }),
    [
      currentClub?.name,
      currentClubId,
      currentTournament?.name,
      currentTournamentId,
      hasUserInfo,
      isAdmin,
      location.pathname,
      location.search,
    ],
  );

  const remoteTournamentResults = safeArray(tournamentSearchState.data);
  const remoteUserResults = safeArray(userSearchState.data);
  const tournamentRows = safeArray(listTournaments);
  const myTournamentRows = safeArray(myTournamentsData, "items");
  const clubRows = safeArray(clubsData, "items");
  const newsRows = safeArray(newsData, "items");

  useEffect(() => {
    if (!open) return undefined;

    setPinnedSnapshots(readPinnedPaletteItems());
    setUsageMemory(readPaletteUsageMemory());
    setRecentSnapshots(readRecentPaletteItems());

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) {
      remoteSearchKeyRef.current = "";
      return undefined;
    }

    const nextQuery = searchText.trim();
    if (nextQuery.length < 2) {
      remoteSearchKeyRef.current = "";
      return undefined;
    }
    const normalizedQuery = normalizeCommandText(nextQuery);
    if (!normalizedQuery) {
      remoteSearchKeyRef.current = "";
      return undefined;
    }

    const shouldSearchTournaments =
      !normalizedScope || normalizedScope === "tournaments";
    const shouldSearchUsers = !normalizedScope || normalizedScope === "players";
    const nextRemoteKey = `${normalizedScope || "all"}:${normalizedQuery}`;
    if (remoteSearchKeyRef.current === nextRemoteKey) return undefined;

    const timer = window.setTimeout(() => {
      remoteSearchKeyRef.current = nextRemoteKey;
      if (shouldSearchTournaments) {
        searchTournaments({ q: nextQuery, limit: 12 }, true);
      }
      if (shouldSearchUsers) {
        searchUsers(nextQuery, true);
      }
    }, REMOTE_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    normalizedScope,
    open,
    searchText,
    searchTournaments,
    searchUsers,
  ]);

  const syncPinnedSnapshots = useCallback(() => {
    setPinnedSnapshots(readPinnedPaletteItems());
  }, []);

  const pinnedIds = useMemo(
    () => new Set(pinnedSnapshots.map((item) => item.id)),
    [pinnedSnapshots],
  );
  const recentIds = useMemo(
    () => new Set(recentSnapshots.map((item) => item.id)),
    [recentSnapshots],
  );

  const handleTogglePinnedItem = useCallback(
    (item) => {
      if (!item?.id || item.persistPin === false) return;

      if (pinnedIds.has(item.id)) {
        removePinnedPaletteItem(item.id);
        syncPinnedSnapshots();
        toast.info(
          t("commandPalette.toasts.unpinned", {
            title: item.title,
          }),
        );
        return;
      }

      writePinnedPaletteItem(item);
      syncPinnedSnapshots();
      toast.success(
        t("commandPalette.toasts.pinned", {
          title: item.title,
        }),
      );
    },
    [pinnedIds, syncPinnedSnapshots, t],
  );

  const handleCopyPaletteLink = useCallback(
    async (item) => {
      const nextUrl = toAbsoluteUrl(item?.path);
      const copied = await copyTextToClipboard(nextUrl);
      if (!copied) {
        toast.error(t("commandPalette.toasts.copyFailed"));
        return;
      }
      toast.success(t("commandPalette.toasts.linkCopied"));
    },
    [t],
  );

  const handleOpenPaletteLink = useCallback((item) => {
    const nextUrl = toAbsoluteUrl(item?.path);
    if (!nextUrl || typeof window === "undefined") return;
    window.open(nextUrl, "_blank", "noopener,noreferrer");
  }, []);

  const calculatorMatch = useMemo(() => {
    if (parsedQuery.prefix && parsedQuery.scope !== "actions") return null;
    return evaluateMathExpression(deferredQuery);
  }, [deferredQuery, parsedQuery.prefix, parsedQuery.scope]);

  const buildSuggestionReason = useCallback(
    (signal) => {
      if (!signal?.score) return "";
      if (signal.pathCount > 0) {
        return t("commandPalette.reasons.path", { count: signal.pathCount });
      }
      if (signal.daypartCount > 0) {
        return t(`commandPalette.dayparts.${usageDaypart}`);
      }
      if (signal.recentHit) {
        return t("commandPalette.reasons.recent");
      }
      if (signal.totalCount > 1) {
        return t("commandPalette.reasons.frequency", {
          count: signal.totalCount,
        });
      }
      return "";
    },
    [t, usageDaypart],
  );

  const actionItems = useMemo(() => {
    const items = [
      createPaletteItem({
        id: "action:toggle-theme",
        scope: "actions",
        title: isDark
          ? t("commandPalette.actions.switchLight")
          : t("commandPalette.actions.switchDark"),
        subtitle: t("commandPalette.actions.themeSubtitle"),
        description: t("commandPalette.descriptions.theme"),
        iconKey: isDark ? "themeLight" : "theme",
        color: isDark ? "#f59e0b" : "#111827",
        priority: 160,
        keywords: ["theme", "dark", "light", "giao dien", "mau nen"],
        aliases: ["toggle theme", "doi theme", "che do toi", "che do sang"],
        metaRows: [
          {
            label: t("commandPalette.preview.current"),
            value: isDark ? t("header.actions.darkMode") : t("header.actions.lightMode"),
          },
        ],
        run: () => toggleTheme(),
      }),
      createPaletteItem({
        id: "action:set-language-vi",
        scope: "actions",
        title: t("commandPalette.actions.switchVietnamese"),
        subtitle: t("commandPalette.actions.languageSubtitle"),
        description: t("commandPalette.descriptions.language"),
        iconKey: "language",
        color: "#0f766e",
        priority: language === "vi" ? 146 : 140,
        keywords: ["language", "tieng viet", "vi", "vietnamese"],
        aliases: ["doi ngon ngu", "switch vietnamese"],
        metaRows: [
          {
            label: t("commandPalette.preview.current"),
            value: t(`common.languages.${language}`),
          },
        ],
        run: () => setLanguage("vi"),
      }),
      createPaletteItem({
        id: "action:set-language-en",
        scope: "actions",
        title: t("commandPalette.actions.switchEnglish"),
        subtitle: t("commandPalette.actions.languageSubtitle"),
        description: t("commandPalette.descriptions.language"),
        iconKey: "language",
        color: "#1759cf",
        priority: language === "en" ? 146 : 140,
        keywords: ["language", "english", "en", "tieng anh"],
        aliases: ["doi ngon ngu", "switch english"],
        metaRows: [
          {
            label: t("commandPalette.preview.current"),
            value: t(`common.languages.${language}`),
          },
        ],
        run: () => setLanguage("en"),
      }),
      createPaletteItem({
        id: "action:reload-page",
        scope: "actions",
        title: t("commandPalette.actions.reloadPage"),
        subtitle: location.pathname,
        description: t("commandPalette.descriptions.reload"),
        iconKey: "refresh",
        color: "#7c3aed",
        priority: 135,
        keywords: ["reload", "refresh", "tai lai", "lam moi", "page"],
        aliases: ["reload page", "refresh page"],
        run: () => window.location.reload(),
      }),
      createPaletteItem({
        id: "action:clear-recents",
        scope: "actions",
        title: t("commandPalette.actions.clearRecent"),
        subtitle: t("commandPalette.actions.clearRecentSubtitle"),
        description: t("commandPalette.descriptions.clearRecent"),
        iconKey: "action",
        color: "#ea580c",
        priority: 120,
        keywords: ["recent", "clear", "history", "gan day", "lich su"],
        aliases: ["clear recents", "xoa lich su"],
        persistRecent: false,
        persistUsage: false,
        run: () => {
          clearRecentPaletteItems();
          setRecentSnapshots([]);
        },
      }),
      createPaletteItem({
        id: "action:copy-current-link",
        scope: "actions",
        title: t("commandPalette.actions.copyPageLink"),
        subtitle: location.pathname,
        description: t("commandPalette.descriptions.copyPageLink"),
        iconKey: "copy",
        color: "#0f766e",
        priority: 130,
        keywords: ["copy", "link", "url", "copy link", "sao chep lien ket"],
        aliases: ["copy page link", "copy current url", "copy link"],
        run: async () => {
          const copied = await copyTextToClipboard(window.location.href);
          if (!copied) {
            throw new Error(t("commandPalette.toasts.copyFailed"));
          }
          toast.success(t("commandPalette.toasts.linkCopied"));
        },
      }),
      createPaletteItem({
        id: "action:open-current-new-tab",
        scope: "actions",
        title: t("commandPalette.actions.openPageNewTab"),
        subtitle: location.pathname,
        description: t("commandPalette.descriptions.openPageNewTab"),
        iconKey: "openExternal",
        color: "#2563eb",
        priority: 122,
        keywords: ["tab", "new tab", "open page", "mo tab moi"],
        aliases: ["open current page", "open in new tab"],
        run: () => {
          window.open(window.location.href, "_blank", "noopener,noreferrer");
        },
      }),
    ];

    if (pinnedSnapshots.length) {
      items.push(
        createPaletteItem({
          id: "action:clear-pinned",
          scope: "actions",
          title: t("commandPalette.actions.clearPinned"),
          subtitle: t("commandPalette.actions.clearPinnedSubtitle"),
          description: t("commandPalette.descriptions.clearPinned"),
          iconKey: "pin",
          color: "#b45309",
          priority: 118,
          keywords: ["pin", "pinned", "favorites", "ghim", "muc ghim"],
          aliases: ["clear pinned", "xoa muc ghim", "clear favorites"],
          persistRecent: false,
          persistUsage: false,
          run: () => {
            clearPinnedPaletteItems();
            setPinnedSnapshots([]);
            toast.success(t("commandPalette.toasts.pinnedCleared"));
          },
        }),
      );
    }

    if (hasUserInfo) {
      items.push(
        createPaletteItem({
          id: "action:logout",
          scope: "actions",
          title: t("commandPalette.actions.logout"),
          subtitle: userInfo?.email || userInfo?.nickname || "",
          description: t("commandPalette.descriptions.logout"),
          iconKey: "logout",
          color: "#dc2626",
          priority: 142,
          keywords: ["logout", "dang xuat", "sign out"],
          aliases: ["log out", "thoat tai khoan"],
          run: async () => {
            await logoutApiCall().unwrap();
            dispatch(logout());
            navigate("/login");
          },
        }),
      );
    }

    return items;
  }, [
    dispatch,
    hasUserInfo,
    isDark,
    language,
    location.pathname,
    logoutApiCall,
    navigate,
    pinnedSnapshots.length,
    setLanguage,
    t,
    toggleTheme,
    userInfo?.email,
    userInfo?.nickname,
  ]);

  const pageItems = useMemo(() => {
    const items = [
      createPaletteItem({
        id: "page:home",
        scope: "pages",
        title: t("mobileNav.home"),
        subtitle: "/",
        description: t("commandPalette.descriptions.home"),
        path: "/",
        iconKey: "home",
        color: "#1759cf",
        priority: 140,
        keywords: ["home", "trang chu", "landing", "pickletour"],
        aliases: ["go home", "ve trang chu"],
      }),
      createPaletteItem({
        id: "page:tournaments",
        scope: "pages",
        title: t("header.nav.tournaments"),
        subtitle: "/pickle-ball/tournaments",
        description: t("commandPalette.descriptions.tournaments"),
        path: "/pickle-ball/tournaments",
        iconKey: "tournament",
        color: "#0f766e",
        priority: 138,
        keywords: ["tournament", "event", "giai dau", "dang ky"],
        aliases: ["events", "giai"],
      }),
      createPaletteItem({
        id: "page:rankings",
        scope: "pages",
        title: t("header.nav.rankings"),
        subtitle: "/pickle-ball/rankings",
        description: t("commandPalette.descriptions.rankings"),
        path: "/pickle-ball/rankings",
        iconKey: "leaderboard",
        color: "#9333ea",
        priority: 130,
        keywords: ["rankings", "ratings", "diem trinh", "bang xep hang"],
        aliases: ["leaderboard", "trinh do"],
      }),
      createPaletteItem({
        id: "page:news",
        scope: "pages",
        title: t("header.nav.news"),
        subtitle: "/news",
        description: t("commandPalette.descriptions.news"),
        path: "/news",
        iconKey: "news",
        color: "#2563eb",
        priority: 129,
        keywords: ["news", "tin tuc", "article", "seo news"],
        aliases: ["stories", "articles"],
      }),
      createPaletteItem({
        id: "page:clubs",
        scope: "pages",
        title: t("header.nav.clubs"),
        subtitle: "/clubs",
        description: t("commandPalette.descriptions.clubs"),
        path: "/clubs",
        iconKey: "club",
        color: "#0f766e",
        priority: 128,
        keywords: ["clubs", "clb", "cau lac bo", "community"],
        aliases: ["club directory", "club list"],
      }),
      createPaletteItem({
        id: "page:live",
        scope: "pages",
        title: t("header.nav.live"),
        subtitle: "/live",
        description: t("commandPalette.descriptions.live"),
        path: "/live",
        iconKey: "status",
        color: "#dc2626",
        priority: 126,
        keywords: ["live", "stream", "court", "truc tiep"],
        aliases: ["live studio", "watch live"],
      }),
      createPaletteItem({
        id: "page:contact",
        scope: "pages",
        title: t("footer.links.contact"),
        subtitle: "/contact",
        description: t("commandPalette.descriptions.contact"),
        path: "/contact",
        iconKey: "page",
        color: "#1d4ed8",
        priority: 110,
        keywords: ["contact", "support", "lien he", "hotline"],
      }),
      createPaletteItem({
        id: "page:status",
        scope: "pages",
        title: t("footer.links.status"),
        subtitle: "/status",
        description: t("commandPalette.descriptions.status"),
        path: "/status",
        iconKey: "status",
        color: "#ca8a04",
        priority: 112,
        keywords: ["status", "system", "uptime", "trang thai"],
      }),
    ];

    if (hasUserInfo) {
      items.push(
        createPaletteItem({
          id: "page:profile",
          scope: "pages",
          title: t("header.actions.profile"),
          subtitle: "/profile",
          description: t("commandPalette.descriptions.profile"),
          path: "/profile",
          iconKey: "player",
          color: "#7c3aed",
          priority: 136,
          keywords: ["profile", "ho so", "tai khoan"],
        }),
        createPaletteItem({
          id: "page:my-tournaments",
          scope: "pages",
          title: t("header.nav.myTournaments"),
          subtitle: "/my-tournaments",
          description: t("commandPalette.descriptions.myTournaments"),
          path: "/my-tournaments",
          iconKey: "tournamentSchedule",
          color: "#0f766e",
          priority: 134,
          keywords: ["my tournaments", "giai cua toi", "match schedule"],
        }),
      );
    } else {
      items.push(
        createPaletteItem({
          id: "page:login",
          scope: "pages",
          title: t("header.actions.login"),
          subtitle: "/login",
          description: t("commandPalette.descriptions.login"),
          path: "/login",
          iconKey: "login",
          color: "#111827",
          priority: 134,
          keywords: ["login", "dang nhap", "auth"],
        }),
        createPaletteItem({
          id: "page:register",
          scope: "pages",
          title: t("header.actions.register"),
          subtitle: "/register",
          description: t("commandPalette.descriptions.register"),
          path: "/register",
          iconKey: "login",
          color: "#1759cf",
          priority: 133,
          keywords: ["register", "dang ky", "sign up"],
        }),
      );
    }

    if (isAdmin) {
      items.push(
        createPaletteItem({
          id: "page:admin",
          scope: "pages",
          title: t("header.nav.admin"),
          subtitle: "/admin",
          description: t("commandPalette.descriptions.admin"),
          path: "/admin",
          iconKey: "admin",
          color: "#7c2d12",
          priority: 148,
          keywords: ["admin", "dashboard", "quan tri"],
        }),
      );
    }

    return items;
  }, [hasUserInfo, isAdmin, t]);

  const contextItems = useMemo(() => {
    const items = [];

    if (currentTournamentId) {
      const tournamentName =
        currentTournament?.name || t("commandPalette.context.currentTournament");

      items.push(
        createPaletteItem({
          id: `context:tournament:overview:${currentTournamentId}`,
          scope: "tournaments",
          title: t("commandPalette.context.tournamentOverview"),
          subtitle: tournamentName,
          description: t("commandPalette.context.tournamentOverviewDesc"),
          path: `/tournament/${currentTournamentId}`,
          iconKey: "tournament",
          color: "#0f766e",
          priority: 190,
          isContextual: true,
          keywords: ["overview", "tong quan", tournamentName],
        }),
        createPaletteItem({
          id: `context:tournament:schedule:${currentTournamentId}`,
          scope: "tournaments",
          title: t("commandPalette.context.tournamentSchedule"),
          subtitle: tournamentName,
          description: t("commandPalette.context.tournamentScheduleDesc"),
          path: `/tournament/${currentTournamentId}/schedule`,
          iconKey: "tournamentSchedule",
          color: "#2563eb",
          priority: 188,
          isContextual: true,
          keywords: ["schedule", "lich thi dau", tournamentName],
        }),
        createPaletteItem({
          id: `context:tournament:bracket:${currentTournamentId}`,
          scope: "tournaments",
          title: t("commandPalette.context.tournamentBracket"),
          subtitle: tournamentName,
          description: t("commandPalette.context.tournamentBracketDesc"),
          path: `/tournament/${currentTournamentId}/bracket`,
          iconKey: "stadium",
          color: "#7c3aed",
          priority: 186,
          isContextual: true,
          keywords: ["bracket", "draw", "nhanh dau", tournamentName],
        }),
        createPaletteItem({
          id: `context:tournament:register:${currentTournamentId}`,
          scope: "tournaments",
          title: t("commandPalette.context.tournamentRegister"),
          subtitle: tournamentName,
          description: t("commandPalette.context.tournamentRegisterDesc"),
          path: `/tournament/${currentTournamentId}/register`,
          iconKey: "login",
          color: "#0891b2",
          priority: 184,
          isContextual: true,
          keywords: ["register", "dang ky", tournamentName],
        }),
      );

      if (hasUserInfo) {
        items.push(
          createPaletteItem({
            id: `context:tournament:manage:${currentTournamentId}`,
            scope: "tournaments",
            title: t("commandPalette.context.tournamentManage"),
            subtitle: tournamentName,
            description: t("commandPalette.context.tournamentManageDesc"),
            path: `/tournament/${currentTournamentId}/manage`,
            iconKey: "admin",
            color: "#b45309",
            priority: 182,
            isContextual: true,
            keywords: ["manage", "quan ly", tournamentName],
          }),
        );
      }

      items.push(
        createPaletteItem({
          id: `context:tournament:draw-stage:${currentTournamentId}`,
          scope: "tournaments",
          title: t("commandPalette.context.drawStage"),
          subtitle: tournamentName,
          description: t("commandPalette.context.drawStageDesc"),
          path: `/tournament/${currentTournamentId}/draw/live`,
          iconKey: "status",
          color: "#dc2626",
          priority: location.pathname.endsWith("/draw/live") ? 194 : 178,
          isContextual: true,
          keywords: ["draw live", "boc tham", "san khau", "stage", tournamentName],
        }),
        createPaletteItem({
          id: `context:tournament:draw-board:${currentTournamentId}`,
          scope: "tournaments",
          title: t("commandPalette.context.drawBoard"),
          subtitle: tournamentName,
          description: t("commandPalette.context.drawBoardDesc"),
          path: `/tournament/${currentTournamentId}/draw/live?view=board`,
          iconKey: "leaderboard",
          color: "#2563eb",
          priority: location.pathname.endsWith("/draw/live") ? 193 : 177,
          isContextual: true,
          keywords: ["draw board", "bang boc tham", "board", tournamentName],
        }),
        createPaletteItem({
          id: `context:tournament:draw-history:${currentTournamentId}`,
          scope: "tournaments",
          title: t("commandPalette.context.drawHistory"),
          subtitle: tournamentName,
          description: t("commandPalette.context.drawHistoryDesc"),
          path: `/tournament/${currentTournamentId}/draw/live?view=history`,
          iconKey: "news",
          color: "#7c3aed",
          priority: location.pathname.endsWith("/draw/live") ? 192 : 176,
          isContextual: true,
          keywords: ["draw history", "lich su boc tham", "history", tournamentName],
        }),
      );
    }

    if (currentClubId) {
      const clubName = currentClub?.name || t("commandPalette.context.currentClub");

      items.push(
        createPaletteItem({
          id: `context:club:home:${currentClubId}`,
          scope: "clubs",
          title: t("commandPalette.context.clubHome"),
          subtitle: clubName,
          description: t("commandPalette.context.clubHomeDesc"),
          path: `/clubs/${currentClubId}`,
          iconKey: "club",
          color: "#0f766e",
          priority: 176,
          isContextual: true,
          keywords: ["club", "home", "trang clb", clubName],
        }),
        createPaletteItem({
          id: `context:club:news:${currentClubId}`,
          scope: "clubs",
          title: t("commandPalette.context.clubNews"),
          subtitle: clubName,
          description: t("commandPalette.context.clubNewsDesc"),
          path: `/clubs/${currentClubId}?tab=news`,
          iconKey: "news",
          color: "#2563eb",
          priority: 174,
          isContextual: true,
          keywords: ["club news", "thong bao", clubName],
        }),
        createPaletteItem({
          id: `context:club:events:${currentClubId}`,
          scope: "clubs",
          title: t("commandPalette.context.clubEvents"),
          subtitle: clubName,
          description: t("commandPalette.context.clubEventsDesc"),
          path: `/clubs/${currentClubId}?tab=events`,
          iconKey: "tournamentSchedule",
          color: "#7c3aed",
          priority: 172,
          isContextual: true,
          keywords: ["events", "su kien", clubName],
        }),
      );
    }

    if (location.pathname.startsWith("/admin")) {
      items.push(
        createPaletteItem({
          id: "context:admin:users",
          scope: "pages",
          title: t("admin.layout.users"),
          subtitle: "/admin/users",
          description: t("commandPalette.context.adminUsersDesc"),
          path: "/admin/users",
          iconKey: "admin",
          color: "#7c2d12",
          priority: 170,
          isContextual: true,
          keywords: ["admin users", "quan ly nguoi dung"],
        }),
        createPaletteItem({
          id: "context:admin:news",
          scope: "pages",
          title: t("admin.layout.news"),
          subtitle: "/admin/news",
          description: t("commandPalette.context.adminNewsDesc"),
          path: "/admin/news",
          iconKey: "news",
          color: "#1d4ed8",
          priority: 168,
          isContextual: true,
          keywords: ["admin news", "quan ly tin tuc"],
        }),
      );
    }

    return items;
  }, [
    currentClub?.name,
    currentClubId,
    currentTournament?.name,
    currentTournamentId,
    hasUserInfo,
    location.pathname,
    t,
  ]);

  const tournamentItems = useMemo(() => {
    const rows = mergePaletteItems(
      tournamentRows.map((item) =>
        createPaletteItem({
          id: `tournament:${sid(item)}`,
          scope: "tournaments",
          title: item?.name || t("commandPalette.fallbacks.untitledTournament"),
          subtitle: [item?.location, formatShortDate(item?.startDate, locale)]
            .filter(Boolean)
            .join(" • "),
          description:
            item?.description ||
            item?.address ||
            t("commandPalette.descriptions.tournamentEntity"),
          path: `/tournament/${sid(item)}`,
          iconKey: "tournament",
          color: "#0f766e",
          priority: 118,
          keywords: [
            item?.name,
            item?.location,
            item?.venue,
            item?.province,
            item?.sportType,
            item?.status,
          ],
          aliases: ["tournament", "giai dau", "dang ky", "bracket"],
          metaRows: [
            ...(item?.location
              ? [{ label: t("common.labels.address"), value: item.location }]
              : []),
            ...(item?.startDate
              ? [
                  {
                    label: t("common.labels.time"),
                    value: formatShortDate(item.startDate, locale),
                  },
                ]
              : []),
          ],
        }),
      ),
      myTournamentRows.map((item) =>
        createPaletteItem({
          id: `tournament:${sid(item)}`,
          scope: "tournaments",
          title: item?.name || t("commandPalette.fallbacks.untitledTournament"),
          subtitle: [
            t("commandPalette.badges.myTournament"),
            formatShortDate(item?.startDate, locale),
          ]
            .filter(Boolean)
            .join(" • "),
          description:
            item?.description || t("commandPalette.descriptions.tournamentEntity"),
          path: `/tournament/${sid(item)}`,
          iconKey: "tournamentSchedule",
          color: "#1759cf",
          priority: 150,
          keywords: [item?.name, item?.location, item?.status, "my tournament"],
          aliases: ["giai cua toi", "my events", "match schedule"],
          metaRows: item?.startDate
            ? [
                {
                  label: t("common.labels.time"),
                  value: formatShortDate(item.startDate, locale),
                },
              ]
            : [],
        }),
      ),
      remoteTournamentResults.map((item) =>
        createPaletteItem({
          id: `tournament:${sid(item)}`,
          scope: "tournaments",
          title: item?.name || t("commandPalette.fallbacks.untitledTournament"),
          subtitle: [item?.location, formatShortDate(item?.startDate, locale)]
            .filter(Boolean)
            .join(" • "),
          description:
            item?.description || t("commandPalette.descriptions.tournamentEntity"),
          path: `/tournament/${sid(item)}`,
          iconKey: "tournament",
          color: "#0f766e",
          priority: 156,
          keywords: [item?.name, item?.location, item?.venue, item?.status],
          aliases: ["tournament", "giai dau"],
        }),
      ),
    );

    return rows;
  }, [
    locale,
    myTournamentRows,
    remoteTournamentResults,
    t,
    tournamentRows,
  ]);

  const clubItems = useMemo(
    () =>
      clubRows.map((club) =>
        createPaletteItem({
          id: `club:${sid(club)}`,
          scope: "clubs",
          title: club?.name || t("commandPalette.fallbacks.untitledClub"),
          subtitle: [club?.province, club?.sport].filter(Boolean).join(" • "),
          description:
            club?.description || t("commandPalette.descriptions.clubEntity"),
          path: `/clubs/${sid(club)}`,
          iconKey: "club",
          color: "#0f766e",
          priority: 112,
          keywords: [
            club?.name,
            club?.province,
            club?.sport,
            club?.visibilityMembers,
          ],
          aliases: ["club", "clb", "cau lac bo", "community"],
          metaRows: [
            ...(club?.province
              ? [{ label: t("common.labels.address"), value: club.province }]
              : []),
          ],
        }),
      ),
    [clubRows, t],
  );

  const newsItems = useMemo(
    () =>
      newsRows.map((article) =>
        createPaletteItem({
          id: `news:${sid(article?.slug)}`,
          scope: "news",
          title: article?.title || t("commandPalette.fallbacks.untitledNews"),
          subtitle: [
            article?.sourceName ||
              (article?.origin === "generated"
                ? t("news.badges.aiEdited")
                : t("news.badges.community")),
            formatShortDate(article?.publishedAt || article?.createdAt, locale),
          ]
            .filter(Boolean)
            .join(" • "),
          description:
            article?.summary ||
            article?.excerpt ||
            t("commandPalette.descriptions.newsEntity"),
          path: `/news/${article?.slug}`,
          iconKey: "news",
          color: "#2563eb",
          priority: 108,
          keywords: [
            article?.title,
            article?.sourceName,
            ...(Array.isArray(article?.tags) ? article.tags : []),
          ],
          aliases: ["news", "tin tuc", "article", "story"],
          metaRows: [
            ...(article?.sourceName
              ? [{ label: t("commandPalette.preview.source"), value: article.sourceName }]
              : []),
            ...(article?.publishedAt || article?.createdAt
              ? [
                  {
                    label: t("common.labels.time"),
                    value: formatShortDate(
                      article?.publishedAt || article?.createdAt,
                      locale,
                    ),
                  },
                ]
              : []),
          ],
        }),
      ),
    [locale, newsRows, t],
  );

  const playerItems = useMemo(
    () =>
      remoteUserResults.map((user) => {
        const label =
          user?.nickname ||
          user?.name ||
          user?.fullName ||
          user?.phone ||
          t("commandPalette.fallbacks.untitledPlayer");

        return createPaletteItem({
          id: `player:${sid(user)}`,
          scope: "players",
          title: label,
          subtitle: [
            user?.nickname ? `@${user.nickname}` : "",
            maskPhone(user?.phone),
            user?.province,
          ]
            .filter(Boolean)
            .join(" • "),
          description:
            user?.email || t("commandPalette.descriptions.playerEntity"),
          path: `/user/${sid(user)}`,
          iconKey: "player",
          color: "#7c3aed",
          priority: 118,
          keywords: [
            user?.nickname,
            user?.name,
            user?.fullName,
            user?.phone,
            user?.email,
            user?.province,
          ],
          aliases: ["player", "user", "van dong vien", "thanh vien"],
          metaRows: [
            ...(user?.email
              ? [{ label: t("common.labels.email"), value: user.email }]
              : []),
            ...(user?.phone
              ? [{ label: t("common.labels.phone"), value: maskPhone(user.phone) }]
              : []),
          ],
        });
      }),
    [remoteUserResults, t],
  );

  const utilityItems = useMemo(() => {
    if (!calculatorMatch) return [];

    const formattedResult = formatMathResult(calculatorMatch.result, locale);

    return [
      createPaletteItem({
        id: `utility:calculator:${calculatorMatch.expression}`,
        scope: "actions",
        title: t("commandPalette.actions.copyCalculationResult"),
        subtitle: `${calculatorMatch.expression} = ${formattedResult}`,
        description: t("commandPalette.descriptions.calculation"),
        iconKey: "calculator",
        color: "#7c3aed",
        priority: 240,
        keywords: [
          "calc",
          "calculate",
          "math",
          "phep tinh",
          calculatorMatch.expression,
          formattedResult,
        ],
        aliases: ["copy result", "calculator result", "tinh nhanh"],
        persistRecent: false,
        persistPin: false,
        persistUsage: false,
        metaRows: [
          {
            label: t("commandPalette.preview.current"),
            value: formattedResult,
          },
        ],
        run: async () => {
          const copied = await copyTextToClipboard(String(calculatorMatch.result));
          if (!copied) {
            throw new Error(t("commandPalette.toasts.copyFailed"));
          }
          toast.success(
            t("commandPalette.toasts.resultCopied", {
              result: formattedResult,
            }),
          );
        },
      }),
    ];
  }, [calculatorMatch, locale, t]);

  const baseItems = useMemo(
    () =>
      mergePaletteItems(
        actionItems,
        utilityItems,
        pageItems,
        contextItems,
        tournamentItems,
        clubItems,
        newsItems,
        playerItems,
      ),
    [
      actionItems,
      clubItems,
      contextItems,
      newsItems,
      pageItems,
      playerItems,
      tournamentItems,
      utilityItems,
    ],
  );

  const intelligentBaseItems = useMemo(
    () =>
      baseItems.map((item) => {
        const signal = scorePalettePersonalization(item, usageMemory, {
          path: currentPathKey,
          daypart: usageDaypart,
        });

        if (!signal.score) return item;

        const reason = buildSuggestionReason(signal);
        const metaRows = Array.isArray(item.metaRows) ? item.metaRows : [];

        return createPaletteItem({
          ...item,
          priority: (item.priority || 0) + signal.score,
          isSuggested: signal.score >= 28 || signal.pathCount >= 1,
          metaRows: reason
            ? [
                ...metaRows,
                {
                  label: t("commandPalette.preview.learned"),
                  value: reason,
                },
              ]
            : metaRows,
        });
      }),
    [baseItems, buildSuggestionReason, currentPathKey, t, usageDaypart, usageMemory],
  );

  const suggestedItems = useMemo(
    () =>
      sortPaletteItems(
        intelligentBaseItems.filter(
          (item) =>
            item.isSuggested &&
            !pinnedIds.has(item.id) &&
            !recentIds.has(item.id),
        ),
      ).slice(0, DISCOVERY_LIMIT),
    [intelligentBaseItems, pinnedIds, recentIds],
  );

  const pinnedItems = useMemo(() => {
    const byId = new Map(intelligentBaseItems.map((item) => [item.id, item]));

    return pinnedSnapshots
      .map((snapshot) => {
        const liveItem = byId.get(snapshot.id);
        const source = liveItem || snapshot;
        if (!source?.id || (!source?.path && !source?.run)) return null;

        return createPaletteItem({
          ...source,
          priority: (source.priority || 0) + 40,
          isPinned: true,
        });
      })
      .filter(Boolean);
  }, [intelligentBaseItems, pinnedSnapshots]);

  const recentItems = useMemo(() => {
    const byId = new Map(intelligentBaseItems.map((item) => [item.id, item]));

    return recentSnapshots
      .map((snapshot) => {
        const liveItem = byId.get(snapshot.id);
        const source = liveItem || snapshot;
        if (!source?.id || (!source?.path && !source?.run)) return null;

        return createPaletteItem({
          ...source,
          priority: (source.priority || 0) + 32,
          isRecent: true,
        });
      })
      .filter(Boolean);
  }, [intelligentBaseItems, recentSnapshots]);

  const searchableItems = useMemo(
    () => mergePaletteItems(pinnedItems, recentItems, intelligentBaseItems),
    [intelligentBaseItems, pinnedItems, recentItems],
  );

  const aiCandidateItems = useMemo(
    () =>
      mergePaletteItems(
        suggestedItems,
        pinnedItems,
        recentItems,
        contextItems,
        actionItems,
        pageItems,
        tournamentItems,
        clubItems,
        newsItems,
        playerItems,
      )
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .slice(0, AI_CANDIDATE_LIMIT),
    [
      actionItems,
      clubItems,
      contextItems,
      newsItems,
      pageItems,
      pinnedItems,
      playerItems,
      recentItems,
      suggestedItems,
      tournamentItems,
    ],
  );

  const aiRequestCandidates = useMemo(
    () =>
      aiCandidateItems.map((item) => ({
        id: item.id,
        scope: item.scope,
        title: item.title,
        subtitle: item.subtitle,
        description: item.description,
        path: item.path,
        keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 6) : [],
        aliases: Array.isArray(item.aliases) ? item.aliases.slice(0, 6) : [],
        isPinned: pinnedIds.has(item.id),
        isRecent: recentIds.has(item.id),
        isSuggested: Boolean(item.isSuggested),
        isContextual: Boolean(item.isContextual),
      })),
    [aiCandidateItems, pinnedIds, recentIds],
  );

  const aiCanAssist =
    open &&
    aiAssistAvailable &&
    hasUserInfo &&
    !calculatorMatch &&
    !aiParsedQuery.prefix &&
    !isAiInputSettling &&
    aiSearchText.trim().length >= AI_ASSIST_MIN_QUERY_LENGTH &&
    aiRequestCandidates.length > 0;

  useEffect(() => {
    if (!aiCanAssist) {
      aiRequestRef.current?.abort?.();
      if (!isAiInputSettling) {
        aiSearchKeyRef.current = "";
        setAiAssistResult(null);
      }
      return undefined;
    }

    const normalizedQuery = normalizeCommandText(aiSearchText);
    if (!normalizedQuery) {
      aiSearchKeyRef.current = "";
      setAiAssistResult(null);
      return undefined;
    }

    const nextKey = JSON.stringify({
      query: normalizedQuery,
      scope: aiNormalizedScope || "all",
      path: currentPathKey,
      locale,
      candidates: aiRequestCandidates.map((item) => item.id),
      context: contextSummary,
    });

    if (aiSearchKeyRef.current === nextKey) return undefined;
    aiSearchKeyRef.current = nextKey;
    aiRequestRef.current?.abort?.();

    const request = triggerAiAssist(
      {
        query: aiSearchText.trim(),
        scope: aiNormalizedScope,
        locale: language || locale,
        currentPath: currentPathKey,
        context: contextSummary,
        candidates: aiRequestCandidates,
      },
      false,
    );

    aiRequestRef.current = request;

    request
      .unwrap()
      .then((result) => {
        if (aiSearchKeyRef.current !== nextKey) return;
        setAiAssistAvailable(true);
        setAiAssistResult(hasMeaningfulAssistResult(result) ? result : null);
      })
      .catch((error) => {
        if (aiSearchKeyRef.current !== nextKey) return;
        const status = Number(
          error?.status || error?.originalStatus || error?.data?.status || 0,
        );
        if (
          status === 401 ||
          status === 403 ||
          status === 404 ||
          status >= 500
        ) {
          setAiAssistAvailable(false);
        }
        setAiAssistResult(null);
      });

    return undefined;
  }, [
    aiCanAssist,
    aiAssistAvailable,
    aiRequestCandidates,
    aiNormalizedScope,
    aiParsedQuery.prefix,
    aiSearchText,
    debouncedAiQuery,
    isAiInputSettling,
    language,
    locale,
    contextSummary,
    currentPathKey,
    triggerAiAssist,
  ]);

  useEffect(
    () => () => {
      aiRequestRef.current?.abort?.();
    },
    [],
  );

  const aiBoostedItems = useMemo(() => {
    if (
      isAiInputSettling ||
      !hasSearchIntent ||
      !Array.isArray(aiAssistResult?.topIds)
    ) {
      return [];
    }

    const byId = new Map(searchableItems.map((item) => [item.id, item]));

    return aiAssistResult.topIds
      .map((itemId, index) => {
        const source = byId.get(itemId);
        if (!source) return null;

        const metaRows = Array.isArray(source.metaRows) ? source.metaRows : [];
        const hasReasonAlready = metaRows.some(
          (row) => row?.label === t("commandPalette.preview.aiReason"),
        );

        return createPaletteItem({
          ...source,
          priority: (source.priority || 0) + 420 - index * 18,
          isAiPrimary: itemId === aiAssistResult.primaryId,
          isSuggested: source.isSuggested || itemId === aiAssistResult.primaryId,
          aiReason: aiAssistResult.reason || "",
          metaRows:
            aiAssistResult.reason && !hasReasonAlready
              ? [
                  ...metaRows,
                  {
                    label: t("commandPalette.preview.aiReason"),
                    value: aiAssistResult.reason,
                  },
                ]
              : metaRows,
        });
      })
      .filter(Boolean);
  }, [aiAssistResult, hasSearchIntent, isAiInputSettling, searchableItems, t]);

  const isAiSearching = Boolean(aiAssistState.isFetching);
  const availableItemsById = useMemo(
    () => new Map(searchableItems.map((item) => [item.id, item])),
    [searchableItems],
  );
  const smartAssistResult = useMemo(
    () =>
      matchCommandPaletteRecipe({
        query: searchText,
        itemsById: availableItemsById,
        context: contextSummary,
        t,
      }),
    [availableItemsById, contextSummary, searchText, t],
  );
  const smartBoostedItems = useMemo(() => {
    if (!hasSearchIntent || !Array.isArray(smartAssistResult?.topIds)) {
      return [];
    }

    return smartAssistResult.topIds
      .map((itemId, index) => {
        const source = availableItemsById.get(itemId);
        if (!source) return null;

        const metaRows = Array.isArray(source.metaRows) ? source.metaRows : [];
        const hasReasonAlready = metaRows.some(
          (row) => row?.label === t("commandPalette.preview.learned"),
        );

        return createPaletteItem({
          ...source,
          priority: (source.priority || 0) + 300 - index * 16,
          isSuggested: true,
          metaRows:
            smartAssistResult.reason && !hasReasonAlready
              ? [
                  ...metaRows,
                  {
                    label: t("commandPalette.preview.learned"),
                    value: smartAssistResult.reason,
                  },
                ]
              : metaRows,
        });
      })
      .filter(Boolean);
  }, [availableItemsById, hasSearchIntent, smartAssistResult, t]);

  const operatorAssistResult = aiAssistResult || smartAssistResult;
  const operatorSource = aiAssistResult ? "ai" : smartAssistResult ? "smart" : null;
  const operatorSuggestedPrompts = useMemo(
    () =>
      Array.isArray(operatorAssistResult?.suggestedPrompts)
        ? operatorAssistResult.suggestedPrompts
        : [],
    [operatorAssistResult?.suggestedPrompts],
  );
  const operatorClarifyChoices = useMemo(
    () =>
      Array.isArray(operatorAssistResult?.clarifyChoices)
        ? operatorAssistResult.clarifyChoices
        : [],
    [operatorAssistResult?.clarifyChoices],
  );
  const operatorHasRewrite =
    Boolean(operatorAssistResult?.queryRewrite) &&
    normalizeCommandText(operatorAssistResult.queryRewrite) !==
      normalizeCommandText(searchText);
  const operatorPrimaryItem = operatorAssistResult?.primaryId
    ? availableItemsById.get(operatorAssistResult.primaryId) || null
    : null;
  const operatorPlanItems = useMemo(() => {
    const sourceIds =
      Array.isArray(operatorAssistResult?.planIds) && operatorAssistResult.planIds.length
        ? operatorAssistResult.planIds
        : operatorAssistResult?.operatorMode === "plan"
          ? operatorAssistResult?.topIds || []
          : [];

    return sourceIds
      .map((itemId) => availableItemsById.get(itemId))
      .filter(Boolean)
      .slice(0, 4);
  }, [
    availableItemsById,
    operatorAssistResult?.operatorMode,
    operatorAssistResult?.planIds,
    operatorAssistResult?.topIds,
  ]);
  const operatorMode = operatorAssistResult?.operatorMode || "pick";
  const operatorVisible = Boolean(
    !isAiInputSettling &&
      hasSearchIntent &&
      (smartAssistResult || (hasUserInfo && (isAiSearching || aiAssistResult))),
  );
  const operatorTitle =
    operatorAssistResult?.operatorTitle ||
    operatorPrimaryItem?.title ||
    (operatorSource === "smart"
      ? t("commandPalette.smart.label")
      : t("commandPalette.ai.label"));
  const operatorHint =
    operatorAssistResult?.operatorHint || operatorAssistResult?.reason || "";
  const operatorCanRunPlan =
    operatorMode === "plan" &&
    operatorPlanItems.length > 1 &&
    operatorPlanItems.every((item) => typeof item?.run === "function" && !item?.path);

  const results = useMemo(() => {
    if (!hasSearchIntent) return [];

    let localResults = [];

    if (!searchText && normalizedScope) {
      localResults = sortPaletteItems(
        searchableItems.filter((item) => item.scope === normalizedScope),
      ).slice(0, RESULT_LIMIT);
    } else {
      localResults = rankPaletteItems(searchableItems, {
        query: searchText,
        scope: normalizedScope,
      }).slice(0, RESULT_LIMIT);
    }

    if (!aiBoostedItems.length && !smartBoostedItems.length) return localResults;

    const boostedItems = [
      ...aiBoostedItems,
      ...smartBoostedItems.filter(
        (item) => !aiBoostedItems.some((aiItem) => aiItem.id === item.id),
      ),
    ];
    const boostedIds = new Set(boostedItems.map((item) => item.id));
    const remainder = localResults.filter((item) => !boostedIds.has(item.id));

    return [...boostedItems, ...remainder].slice(0, RESULT_LIMIT);
  }, [
    aiBoostedItems,
    hasSearchIntent,
    normalizedScope,
    searchText,
    searchableItems,
    smartBoostedItems,
  ]);
  const emptySuggestedPrompts = useMemo(() => {
    if (!hasSearchIntent || results.length) return [];
    if (operatorSuggestedPrompts.length) {
      return operatorSuggestedPrompts.slice(0, DISCOVERY_LIMIT);
    }

    return [
      contextItems[0]?.title,
      actionItems.find((item) => item.id === "action:copy-current-link")?.title,
      pageItems.find((item) => item.id === "page:my-tournaments")?.title,
      pageItems.find((item) => item.id === "page:news")?.title,
      pageItems.find((item) => item.id === "page:clubs")?.title,
    ]
      .filter(Boolean)
      .slice(0, DISCOVERY_LIMIT);
  }, [
    actionItems,
    contextItems,
    hasSearchIntent,
    operatorSuggestedPrompts,
    pageItems,
    results.length,
  ]);

  const discoveryGroups = useMemo(
    () =>
      [
        {
          key: "suggested",
          label: t("commandPalette.sections.suggested"),
          items: suggestedItems,
        },
        {
          key: "favorites",
          label: t("commandPalette.sections.favorites"),
          items: pinnedItems.slice(0, DISCOVERY_LIMIT),
        },
        {
          key: "recent",
          label: t("commandPalette.sections.recent"),
          items: recentItems.slice(0, DISCOVERY_LIMIT),
        },
        {
          key: "context",
          label: t("commandPalette.sections.context"),
          items: contextItems.slice(0, DISCOVERY_LIMIT),
        },
        {
          key: "actions",
          label: t("commandPalette.sections.actions"),
          items: actionItems.slice(0, DISCOVERY_LIMIT),
        },
        {
          key: "pages",
          label: t("commandPalette.sections.pages"),
          items: pageItems.slice(0, DISCOVERY_LIMIT),
        },
        {
          key: "tournaments",
          label: t("commandPalette.sections.tournaments"),
          items: tournamentItems.slice(0, DISCOVERY_LIMIT),
        },
        {
          key: "clubs",
          label: t("commandPalette.sections.clubs"),
          items: clubItems.slice(0, DISCOVERY_LIMIT),
        },
        {
          key: "news",
          label: t("commandPalette.sections.news"),
          items: newsItems.slice(0, DISCOVERY_LIMIT),
        },
      ].filter((group) => group.items.length > 0),
      [
      suggestedItems,
      actionItems,
      clubItems,
      contextItems,
      newsItems,
      pageItems,
      pinnedItems,
      recentItems,
      t,
      tournamentItems,
    ],
  );

  const flatItems = useMemo(() => {
    if (hasSearchIntent) return results;
    return discoveryGroups.flatMap((group) => group.items);
  }, [discoveryGroups, hasSearchIntent, results]);

  const selectedItem = flatItems[selectedIndex] || flatItems[0] || null;
  const selectedItemIsPinned = selectedItem ? pinnedIds.has(selectedItem.id) : false;
  const isRemoteSearching =
    searchText.trim().length >= 2 &&
    (tournamentSearchState.isFetching || userSearchState.isFetching);

  useEffect(() => {
    setSelectedIndex(0);
    keyboardNavigationRef.current = false;
    const container = resultsScrollRef.current;
    if (container) container.scrollTop = 0;
  }, [hasSearchIntent, normalizedScope, open, searchText]);

  useEffect(() => {
    if (selectedIndex < flatItems.length) return;
    setSelectedIndex(flatItems.length ? 0 : -1);
  }, [flatItems.length, selectedIndex]);

  useEffect(() => {
    if (selectedIndex < 0 || !keyboardNavigationRef.current) return;

    const container = resultsScrollRef.current;
    const node = itemRefs.current[selectedIndex];
    if (!container || !node) return;

    const top = node.offsetTop;
    const bottom = top + node.offsetHeight;
    const viewportTop = container.scrollTop;
    const viewportBottom = viewportTop + container.clientHeight;
    const padding = 10;

    if (top < viewportTop + padding) {
      container.scrollTop = Math.max(top - padding, 0);
    } else if (bottom > viewportBottom - padding) {
      container.scrollTop = bottom - container.clientHeight + padding;
    }

    keyboardNavigationRef.current = false;
  }, [selectedIndex]);

  useEffect(
    () => () => {
      if (listScrollSettleRef.current) {
        window.clearTimeout(listScrollSettleRef.current);
      }
    },
    [],
  );

  const markListScrolling = useCallback(() => {
    isListScrollingRef.current = true;
    if (listScrollSettleRef.current) {
      window.clearTimeout(listScrollSettleRef.current);
    }
    listScrollSettleRef.current = window.setTimeout(() => {
      isListScrollingRef.current = false;
    }, 96);
  }, []);

  const selectFromHover = useCallback((index) => {
    if (isListScrollingRef.current) return;
    keyboardNavigationRef.current = false;
    setSelectedIndex((current) => (current === index ? current : index));
  }, []);

  const handleClose = useCallback(() => {
    aiSearchKeyRef.current = "";
    aiRequestRef.current?.abort?.();
    setAiAssistResult(null);
    setAiAssistAvailable(true);
    closePalette();
    setQuery("");
    setQueryInputSyncKey((current) => current + 1);
    setSelectedScope("all");
    setSelectedIndex(0);
  }, [closePalette]);

  const setProgrammaticQuery = useCallback((nextValue) => {
    setQuery(String(nextValue || ""));
    setQueryInputSyncKey((current) => current + 1);
  }, []);

  const executePaletteItem = useCallback(
    async (item, options = {}) => {
      if (!item) return;

      const {
        closeAfter = true,
        persistRecent = item.persistRecent !== false,
        persistUsage = item.persistUsage !== false,
      } = options;

      try {
        if (persistRecent) {
          writeRecentPaletteItem(item);
        }

        if (persistUsage) {
          const nextUsageMemory = recordPaletteItemUsage(item, {
            path: currentPathKey,
            daypart: usageDaypart,
          });
          setUsageMemory(nextUsageMemory);
        }

        if (typeof item.run === "function") {
          await item.run();
        } else if (item.path) {
          navigate(item.path);
        }

        setRecentSnapshots(readRecentPaletteItems());
        if (closeAfter) handleClose();
      } catch (error) {
        toast.error(error?.data?.message || error?.message || "Action failed");
      }
    },
    [currentPathKey, handleClose, navigate, usageDaypart],
  );

  const activateItem = useCallback(
    async (item) => {
      await executePaletteItem(item);
    },
    [executePaletteItem],
  );

  const applyOperatorRewrite = useCallback(() => {
    if (!operatorHasRewrite || !operatorAssistResult?.queryRewrite) return;

    setProgrammaticQuery(operatorAssistResult.queryRewrite);
  }, [operatorAssistResult?.queryRewrite, operatorHasRewrite, setProgrammaticQuery]);

  const runOperatorPrimary = useCallback(async () => {
    if (!operatorPrimaryItem) return;
    await executePaletteItem(operatorPrimaryItem);
  }, [executePaletteItem, operatorPrimaryItem]);

  const runOperatorPlan = useCallback(async () => {
    if (!operatorCanRunPlan || operatorPlanItems.length < 2) return;

    for (const item of operatorPlanItems) {
      // Execute a safe local plan without navigating away midway.
      // These plans are restricted to action items only.
      // eslint-disable-next-line no-await-in-loop
      await executePaletteItem(item, { closeAfter: false });
    }

    handleClose();
  }, [executePaletteItem, handleClose, operatorCanRunPlan, operatorPlanItems]);

  const handleKeyDown = (event) => {
    if (!open) return;

    if (event.key === "Tab" && operatorHasRewrite) {
      event.preventDefault();
      applyOperatorRewrite();
      return;
    }

    if (
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      (operatorCanRunPlan || operatorPrimaryItem)
    ) {
      event.preventDefault();
      if (operatorCanRunPlan) {
        runOperatorPlan();
      } else {
        runOperatorPrimary();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      keyboardNavigationRef.current = true;
      setSelectedIndex((current) =>
        Math.min(current + 1, Math.max(flatItems.length - 1, 0)),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      keyboardNavigationRef.current = true;
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      if (!selectedItem) return;
      event.preventDefault();
      activateItem(selectedItem);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      handleClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen={isMobile}
      fullWidth
      maxWidth="lg"
      keepMounted
      PaperProps={{
        onKeyDown: handleKeyDown,
        sx: {
          borderRadius: { xs: 0, md: 4 },
          overflow: "hidden",
          background: isDark
            ? "linear-gradient(180deg, rgba(14,14,18,0.98) 0%, rgba(9,9,12,0.98) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)",
          boxShadow: isDark
            ? "0 32px 80px rgba(0,0,0,0.45)"
            : "0 32px 80px rgba(15,23,42,0.18)",
          minHeight: { xs: "100dvh", md: 640 },
          maxHeight: { xs: "100dvh", md: "min(88vh, 820px)" },
        },
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100%" }}>
        <Box
          sx={{
            px: { xs: 1.5, md: 2.25 },
            pt: { xs: 1.5, md: 2 },
            pb: 1.5,
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
          }}
        >
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={1}
            >
              <Stack direction="row" spacing={1.1} alignItems="center">
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: 2.5,
                    display: "grid",
                    placeItems: "center",
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    color: "primary.main",
                  }}
                >
                  <SearchRounded />
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                    {t("commandPalette.title")}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t("commandPalette.subtitle")}
                  </Typography>
                </Box>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                {!isMobile ? (
                  <Chip
                    icon={<KeyboardCommandKeyRounded sx={{ fontSize: 18 }} />}
                    label="Ctrl K"
                    variant="outlined"
                    sx={{ fontWeight: 700 }}
                  />
                ) : null}
                <Tooltip title={t("common.actions.close")}>
                  <IconButton onClick={handleClose}>
                    <ClearRounded />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Stack>

            <PaletteSearchInput
              inputRef={inputRef}
              externalValue={query}
              syncKey={queryInputSyncKey}
              isBusy={Boolean(isRemoteSearching || isAiSearching)}
              onCommittedChange={setQuery}
              placeholder={t("commandPalette.placeholder")}
              clearAriaLabel={t("common.actions.clear")}
              commitDelayMs={INPUT_COMMIT_DEBOUNCE_MS}
            />

            <PaletteOperatorStrip
              visible={operatorVisible}
              isSearching={isAiSearching}
              isDark={isDark}
              source={operatorSource}
              suggestedScope={operatorAssistResult?.suggestedScope || ""}
              operatorTitle={operatorTitle}
              operatorHint={operatorHint}
              operatorMode={operatorMode}
              hasRewrite={operatorHasRewrite}
              rewriteQuery={operatorAssistResult?.queryRewrite || ""}
              primaryItem={operatorPrimaryItem}
              planItems={operatorPlanItems}
              clarifyQuestion={operatorAssistResult?.clarifyQuestion || ""}
              clarifyChoices={operatorClarifyChoices}
              suggestedPrompts={operatorSuggestedPrompts}
              canRunPlan={operatorCanRunPlan}
              onSelectScope={setSelectedScope}
              onApplyRewrite={applyOperatorRewrite}
              onRunPrimary={runOperatorPrimary}
              onRunPlan={runOperatorPlan}
              onActivateItem={activateItem}
              onSelectPrompt={setProgrammaticQuery}
              t={t}
            />

            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              flexWrap="wrap"
              sx={{ overflowX: "auto" }}
            >
              {SCOPE_OPTIONS.map((scope) => {
                const selected = activeScope === scope.value;

                return (
                  <Chip
                    key={scope.value}
                    clickable
                    label={
                      scope.value === "all"
                        ? t("commandPalette.scopes.all")
                        : `${scope.prefix} ${t(`commandPalette.scopes.${scope.value}`)}`
                    }
                    onClick={() => setSelectedScope(scope.value)}
                    color={selected ? "primary" : "default"}
                    variant={selected ? "filled" : "outlined"}
                    sx={{ fontWeight: 700 }}
                  />
                );
              })}
            </Stack>
          </Stack>
        </Box>

        <PaletteResultsPane
          hasSearchIntent={hasSearchIntent}
          results={results}
          discoveryGroups={discoveryGroups}
          selectedIndex={selectedIndex}
          selectedItem={selectedItem}
          selectedItemIsPinned={selectedItemIsPinned}
          emptySuggestedPrompts={emptySuggestedPrompts}
          itemRefs={itemRefs}
          resultsScrollRef={resultsScrollRef}
          isDark={isDark}
          onScroll={markListScrolling}
          onHoverSelect={selectFromHover}
          onActivateItem={activateItem}
          onSelectPrompt={setProgrammaticQuery}
          onTogglePin={handleTogglePinnedItem}
          onCopyLink={handleCopyPaletteLink}
          onOpenLink={handleOpenPaletteLink}
          t={t}
        />

        <Box
          sx={{
            px: { xs: 1.25, md: 2 },
            py: 1.15,
            borderTop: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
            bgcolor: alpha(theme.palette.background.paper, isDark ? 0.48 : 0.86),
          }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", md: "center" }}
          >
            <Typography variant="caption" color="text.secondary">
              {t("commandPalette.prefixHint")}
            </Typography>
            <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
              <Typography variant="caption" color="text.secondary">
                {t("commandPalette.footer.enter")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("commandPalette.footer.navigate")}
              </Typography>
              {operatorHasRewrite ? (
                <Typography variant="caption" color="text.secondary">
                  {t(
                    operatorSource === "smart"
                      ? "commandPalette.smart.keyboardRewrite"
                      : "commandPalette.ai.keyboardRewrite",
                  )}
                </Typography>
              ) : null}
              {operatorCanRunPlan || operatorPrimaryItem ? (
                <Typography variant="caption" color="text.secondary">
                  {t(
                    operatorCanRunPlan
                      ? "commandPalette.smart.keyboardRunPlan"
                      : operatorSource === "smart"
                        ? "commandPalette.smart.keyboardRun"
                        : "commandPalette.ai.keyboardRun",
                  )}
                </Typography>
              ) : null}
              <Typography variant="caption" color="text.secondary">
                {t("commandPalette.footer.pin")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("commandPalette.footer.close")}
              </Typography>
            </Stack>
          </Stack>
        </Box>
      </Box>
    </Dialog>
  );
}
