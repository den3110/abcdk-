/* eslint-disable react/prop-types */
// src/components/ChatBotDrawer.jsx
import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import {
  Drawer,
  Fab,
  Box,
  Typography,
  TextField,
  IconButton,
  Avatar,
  CircularProgress,
  Divider,
  Tooltip,
  Badge,
  Fade,
  Collapse,
  Chip,
  useMediaQuery,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Tabs,
  Tab,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SettingsIcon from "@mui/icons-material/Settings";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PsychologyIcon from "@mui/icons-material/Psychology";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TipsAndUpdatesIcon from "@mui/icons-material/TipsAndUpdates";
import SchoolIcon from "@mui/icons-material/School";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import LinkRoundedIcon from "@mui/icons-material/LinkRounded";
import ThumbUpAltOutlinedIcon from "@mui/icons-material/ThumbUpAltOutlined";
import ThumbDownAltOutlinedIcon from "@mui/icons-material/ThumbDownAltOutlined";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DoneRoundedIcon from "@mui/icons-material/DoneRounded";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useClearChatHistoryMutation,
  useClearLearningMemoryMutation,
  useSendChatFeedbackMutation,
  useSendChatTelemetryEventMutation,
  chatBotApiSlice,
} from "../slices/chatBotApiSlice";
import { useSelector } from "react-redux";
import { useNavigate as useRouterNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useChatBotPageContext } from "../context/ChatBotPageContext.jsx";

const BOT_ICON = "/icon-chatbot-192.png";
const REASONING_MODE_STORAGE_KEY = "pikora-reasoning-mode";
const ASSISTANT_MODE_STORAGE_KEY = "pikora-assistant-mode";
const VERIFICATION_MODE_STORAGE_KEY = "pikora-verification-mode";
const SESSION_FOCUS_OVERRIDE_STORAGE_KEY = "pikora-session-focus-override";
const CHATBOT_COHORT_STORAGE_KEY = "pikora-cohort-id";
const CHATBOT_UI_PREFS_STORAGE_KEY = "pikora-ui-preferences";
const CHATBOT_FORM_DRAFTS_STORAGE_KEY = "pikora-form-drafts";
const PICKLETOUR_VERSION =
  import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_VERSION || "dev";

function normalizeAssistantModeValue(value) {
  if (value === "operator") return "operator";
  if (value === "analyst") return "analyst";
  return "balanced";
}

function normalizeVerificationModeValue(value) {
  return value === "strict" ? "strict" : "balanced";
}

function getAssistantModeMeta(mode, t) {
  const normalized = normalizeAssistantModeValue(mode);
  if (normalized === "operator") {
    return {
      value: "operator",
      label: t("chatbot.assistantMode.operator", {}, "Operator Pro"),
      description: t(
        "chatbot.assistantMode.operatorHint",
        {},
        "Ưu tiên thao tác, điều hướng và bước tiếp theo có thể bấm ngay.",
      ),
      shortLabel: t(
        "chatbot.assistantMode.operatorShort",
        {},
        "Operator Pro",
      ),
      icon: <TipsAndUpdatesIcon fontSize="small" />,
    };
  }
  if (normalized === "analyst") {
    return {
      value: "analyst",
      label: t("chatbot.assistantMode.analyst", {}, "Phân tích"),
      description: t(
        "chatbot.assistantMode.analystHint",
        {},
        "Ưu tiên so sánh, lý do, cấu trúc phân tích và nhận định ngắn gọn.",
      ),
      shortLabel: t("chatbot.assistantMode.analystShort", {}, "Phân tích"),
      icon: <SchoolIcon fontSize="small" />,
    };
  }
  return {
    value: "balanced",
    label: t("chatbot.assistantMode.balanced", {}, "Cân bằng"),
    description: t(
      "chatbot.assistantMode.balancedHint",
      {},
      "Cân bằng giữa trả lời trực tiếp, giải thích ngắn và gợi ý thao tác.",
    ),
    shortLabel: t("chatbot.assistantMode.balancedShort", {}, "Cân bằng"),
    icon: <SmartToyIcon fontSize="small" />,
  };
}

function getVerificationModeMeta(mode, t) {
  const normalized = normalizeVerificationModeValue(mode);
  if (normalized === "strict") {
    return {
      value: "strict",
      label: t("chatbot.verificationMode.strict", {}, "Xác minh chặt"),
      description: t(
        "chatbot.verificationMode.strictHint",
        {},
        "Ưu tiên trả lời đã kiểm chứng, thiếu dữ liệu thì nói rõ là chưa đủ xác minh.",
      ),
      shortLabel: t(
        "chatbot.verificationMode.strictShort",
        {},
        "Xác minh chặt",
      ),
      icon: <CheckCircleOutlineIcon fontSize="small" />,
    };
  }
  return {
    value: "balanced",
    label: t("chatbot.verificationMode.balanced", {}, "Xác minh cân bằng"),
    description: t(
      "chatbot.verificationMode.balancedHint",
      {},
      "Giữ độ đúng cao nhưng vẫn cho phép định hướng ngắn gọn khi chưa đủ grounding.",
    ),
    shortLabel: t(
      "chatbot.verificationMode.balancedShort",
      {},
      "Xác minh cân bằng",
    ),
    icon: <AutoAwesomeIcon fontSize="small" />,
  };
}

function getSessionFocusMeta(sessionFocus, t) {
  if (!sessionFocus || typeof sessionFocus !== "object") return null;
  const activeType = String(sessionFocus.activeType || "").trim();
  if (!activeType) return null;
  const activeFocus = sessionFocus?.[activeType];
  if (!activeFocus || typeof activeFocus !== "object") return null;

  const fallbackLabels = {
    tournament: t("chatbot.sessionFocus.tournament", {}, "Giải hiện tại"),
    club: t("chatbot.sessionFocus.club", {}, "Câu lạc bộ hiện tại"),
    news: t("chatbot.sessionFocus.news", {}, "Bài viết hiện tại"),
    player: t("chatbot.sessionFocus.player", {}, "Người chơi hiện tại"),
    match: t("chatbot.sessionFocus.match", {}, "Trận hiện tại"),
  };

  const rawLabel = String(activeFocus.label || "").trim();
  const label = rawLabel || fallbackLabels[activeType] || fallbackLabels.tournament;
  if (!label) return null;

  return {
    activeType,
    label,
    chipLabel: `${t("chatbot.sessionFocus.tracking", {}, "Đang theo dõi")}: ${label}`,
    typeLabel:
      {
        tournament: t("chatbot.sessionFocus.typeTournament", {}, "Giải"),
        club: t("chatbot.sessionFocus.typeClub", {}, "CLB"),
        news: t("chatbot.sessionFocus.typeNews", {}, "Tin"),
        player: t("chatbot.sessionFocus.typePlayer", {}, "VĐV"),
        match: t("chatbot.sessionFocus.typeMatch", {}, "Trận"),
      }[activeType] || t("chatbot.sessionFocus.typeGeneric", {}, "Ngữ cảnh"),
    accent:
      {
        tournament: "#2563EB",
        club: "#0F766E",
        news: "#7C3AED",
        player: "#EA580C",
        match: "#DC2626",
      }[activeType] || "#2563EB",
  };
}

function getSessionFocusStateMeta(sessionFocusState, t) {
  if (!sessionFocusState || typeof sessionFocusState !== "object") return null;
  const mode = String(sessionFocusState.mode || "").trim().toLowerCase();
  if (mode === "pin") {
    return {
      label: t("chatbot.sessionFocus.pinned", {}, "Đã ghim"),
      accent: "#7C3AED",
    };
  }
  if (mode === "off") {
    return {
      label: t("chatbot.sessionFocus.off", {}, "Ngữ cảnh hội thoại đang tắt"),
      accent: "#D97706",
    };
  }
  if (mode === "auto") {
    return {
      label: t("chatbot.sessionFocus.auto", {}, "Tự động"),
      accent: "#0F9D58",
    };
  }
  return null;
}

function getActiveSessionFocusEntity(sessionFocus) {
  if (!sessionFocus || typeof sessionFocus !== "object") return null;
  const activeType = String(sessionFocus.activeType || "").trim();
  if (!activeType) return null;
  const activeFocus = sessionFocus?.[activeType];
  if (!activeFocus || typeof activeFocus !== "object") return null;
  return {
    activeType,
    entityId: String(activeFocus.entityId || "").trim(),
    label: String(activeFocus.label || "").trim(),
  };
}

function normalizeSessionFocusOverrideValue(override) {
  if (!override || typeof override !== "object") {
    return { mode: "auto", sessionFocus: null };
  }
  const mode = ["auto", "off", "pin"].includes(
    String(override.mode || "").trim().toLowerCase(),
  )
    ? String(override.mode).trim().toLowerCase()
    : "auto";

  if (mode !== "pin") {
    return { mode, sessionFocus: null };
  }

  const activeFocus = getActiveSessionFocusEntity(override.sessionFocus);
  if (!activeFocus) {
    return { mode: "auto", sessionFocus: null };
  }

  return {
    mode: "pin",
    sessionFocus: override.sessionFocus,
  };
}

function sessionFocusMatches(leftFocus, rightFocus) {
  const left = getActiveSessionFocusEntity(leftFocus);
  const right = getActiveSessionFocusEntity(rightFocus);
  if (!left || !right) return false;
  if (left.activeType !== right.activeType) return false;
  if (left.entityId && right.entityId) {
    return left.entityId === right.entityId;
  }
  return left.label && right.label ? left.label === right.label : false;
}

// ─── Initial Suggestions (only for welcome screen) ───
function getWelcomeSuggestions(userInfo, t) {
  return userInfo
    ? t("chatbot.suggestions.member")
    : t("chatbot.suggestions.guest");
}

function compactText(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function compactUniqueTexts(values, limit = 8, maxLength = 96) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => compactText(value, maxLength))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function compactStats(stats) {
  if (!stats || typeof stats !== "object") return null;

  const next = {};
  for (const [key, value] of Object.entries(stats)) {
    const safeKey = compactText(key, 48);
    if (!safeKey) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      next[safeKey] = value;
      continue;
    }
    const textValue = compactText(value, 96);
    if (textValue) {
      next[safeKey] = textValue;
    }
  }

  return Object.keys(next).length ? next : null;
}

function compactStructuredItems(list, limit = 8) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      id: compactText(item?.id, 64),
      name: compactText(item?.name, 140),
      status: compactText(item?.status, 32),
      location: compactText(item?.location, 96),
      startDate: compactText(item?.startDate, 48),
      endDate: compactText(item?.endDate, 48),
    }))
    .filter((item) => item.name)
    .slice(0, limit);
}

function getOrCreateChatCohortId() {
  if (typeof window === "undefined") return "web-anonymous";

  const existing = window.localStorage.getItem(CHATBOT_COHORT_STORAGE_KEY);
  if (existing) return existing;

  const nextId =
    window.crypto?.randomUUID?.() ||
    `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(CHATBOT_COHORT_STORAGE_KEY, nextId);
  return nextId;
}

function getVisibleTextFromNodes(selectors, limit = 8, maxLength = 80) {
  if (typeof document === "undefined") return [];

  const nodes = selectors.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector)),
  );

  return compactUniqueTexts(
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect?.();
        return rect ? rect.width > 0 && rect.height > 0 : true;
      })
      .map((node) => node.textContent || ""),
    limit,
    maxLength,
  );
}

function collectDomPageSnapshot() {
  if (typeof document === "undefined") return null;

  const heading =
    compactText(
      document.querySelector("main h1, [data-chatbot-page-title]")?.textContent,
      140,
    ) || "";
  const sectionTitle =
    compactText(
      document.querySelector("main h2, main [role='heading'][aria-level='2']")?.textContent,
      120,
    ) || "";
  const pageSummary =
    compactText(
      document.querySelector(
        "main p, [data-chatbot-page-summary], meta[name='description']",
      )?.textContent ||
        document
          .querySelector("meta[name='description']")
          ?.getAttribute("content"),
      220,
    ) || "";

  const activeLabels = getVisibleTextFromNodes(
    [
      "[role='tab'][aria-selected='true']",
      ".Mui-selected",
      "[aria-current='page']",
      "[data-chatbot-active='true']",
    ],
    8,
    64,
  );
  const visibleActions = getVisibleTextFromNodes(
    [
      "main button",
      "main [role='button']",
      "main a[role='button']",
      "[data-chatbot-action]",
    ],
    8,
    64,
  );
  const highlights = getVisibleTextFromNodes(
    [
      "main .MuiChip-label",
      "main .MuiCard-root .MuiTypography-subtitle1",
      "main .MuiCard-root .MuiTypography-h6",
      "main .MuiCard-root img[alt]",
      "main [data-chatbot-highlight]",
      "nav[aria-label*='breadcrumb'] a",
      "nav[aria-label*='breadcrumb'] span",
    ],
    8,
    80,
  );
  const metrics = getVisibleTextFromNodes(
    [
      "main [data-chatbot-metric]",
      "main .MuiTypography-h3",
      "main .MuiTypography-h4",
      "main .MuiTypography-h5",
    ],
    6,
    64,
  );

  const snapshot = {
    entityTitle: heading,
    sectionTitle,
    pageSummary,
    activeLabels,
    visibleActions,
    highlights,
    metrics,
  };

  return Object.values(snapshot).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  )
    ? snapshot
    : null;
}

function buildChatContextPayload(registeredSnapshot) {
  const domSnapshot = collectDomPageSnapshot();
  const merged = {
    pageType: compactText(registeredSnapshot?.pageType, 64),
    pageSection: compactText(registeredSnapshot?.pageSection, 64),
    pageView: compactText(registeredSnapshot?.pageView, 64),
    entityTitle: compactText(
      registeredSnapshot?.entityTitle || domSnapshot?.entityTitle,
      140,
    ),
    sectionTitle: compactText(
      registeredSnapshot?.sectionTitle || domSnapshot?.sectionTitle,
      120,
    ),
    pageSummary: compactText(
      registeredSnapshot?.pageSummary || domSnapshot?.pageSummary,
      220,
    ),
    activeLabels: compactUniqueTexts(
      [...(registeredSnapshot?.activeLabels || []), ...(domSnapshot?.activeLabels || [])],
      8,
      64,
    ),
    visibleActions: compactUniqueTexts(
      [
        ...(registeredSnapshot?.visibleActions || []),
        ...(domSnapshot?.visibleActions || []),
      ],
      8,
      64,
    ),
    highlights: compactUniqueTexts(
      [...(registeredSnapshot?.highlights || []), ...(domSnapshot?.highlights || [])],
      8,
      88,
    ),
    metrics: compactUniqueTexts(
      [...(registeredSnapshot?.metrics || []), ...(domSnapshot?.metrics || [])],
      8,
      88,
    ),
    stats: compactStats(registeredSnapshot?.stats),
    visibleTournaments: compactStructuredItems(registeredSnapshot?.visibleTournaments, 8),
    tournamentId: compactText(registeredSnapshot?.tournamentId, 48),
    clubId: compactText(registeredSnapshot?.clubId, 48),
    newsSlug: compactText(registeredSnapshot?.newsSlug, 96),
    matchId: compactText(registeredSnapshot?.matchId, 48),
    courtId: compactText(registeredSnapshot?.courtId, 48),
  };

  return Object.values(merged).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  )
    ? merged
    : null;
}

// ═══════════════════════════════════════════
//  Markdown Renderer
// ═══════════════════════════════════════════
const MarkdownContent = memo(function MarkdownContent({
  text,
  theme,
  onLinkClick,
}) {
  const isDark = theme.palette.mode === "dark";
  const navigate = useRouterNavigate();
  const components = useMemo(
    () => ({
      a: ({ href, children }) => {
        if (!href) return <span>{children}</span>;

        // Extract pathname from any URL (react-markdown may resolve
        // relative paths like /user/x into https://example.com/user/x)
        let internalPath = null;
        try {
          const url = new URL(href, window.location.origin);
          const p = url.pathname;
          // Known internal routes — always treat as SPA navigation
          const internalPrefixes = [
            "/user/",
            "/tournament/",
            "/club/",
            "/pickle-ball/",
          ];
          if (
            url.origin === window.location.origin ||
            internalPrefixes.some((prefix) => p.startsWith(prefix))
          ) {
            internalPath = p;
          }
        } catch {
          // Not a full URL — treat as relative path
          if (!href.startsWith("mailto:")) {
            internalPath = href.startsWith("/") ? href : `/${href}`;
          }
        }

        if (internalPath) {
          return (
            <Box
              component="span"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onLinkClick?.();
                navigate(internalPath);
              }}
              sx={{
                color: theme.palette.primary.main,
                cursor: "pointer",
                textDecoration: "underline",
                "&:hover": { opacity: 0.8 },
              }}
            >
              {children}
            </Box>
          );
        }
        return (
          <Box
            component="a"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ color: theme.palette.primary.main }}
          >
            {children}
          </Box>
        );
      },
      table: ({ children }) => {
        // Extract headers and rows from React children
        const extractText = (node) => {
          if (!node) return "";
          if (typeof node === "string") return node;
          if (typeof node === "number") return String(node);
          if (Array.isArray(node)) return node.map(extractText).join("");
          if (node?.props?.children) return extractText(node.props.children);
          return "";
        };

        let headers = [];
        let rows = [];
        let rowNodes = []; // Keep original React children for card mode
        const childArr = Array.isArray(children) ? children : [children];
        childArr.forEach((child) => {
          if (!child?.props?.children) return;
          const sections = Array.isArray(child.props.children)
            ? child.props.children
            : [child.props.children];
          sections.forEach((section) => {
            if (!section?.props?.children) return;
            const trs = Array.isArray(section.props.children)
              ? section.props.children
              : [section.props.children];
            trs.forEach((tr) => {
              if (!tr?.props?.children) return;
              const cells = Array.isArray(tr.props.children)
                ? tr.props.children
                : [tr.props.children];
              const texts = cells.map((c) => extractText(c));
              // Detect header row: check if cells are th type
              const isHeader = cells.some(
                (c) => c?.props?.node?.tagName === "th" || c?.type === "th",
              );
              if (isHeader || headers.length === 0) {
                headers = texts;
              } else {
                rows.push(texts);
                // Keep original cell children for rendering links in card mode
                rowNodes.push(
                  cells.map((c) => c?.props?.children ?? extractText(c)),
                );
              }
            });
          });
        });

        const colCount = headers.length;

        // ─── CARD MODE (> 3 columns) ───
        if (colCount > 3) {
          return (
            <Box
              sx={{ my: 1.5, display: "flex", flexDirection: "column", gap: 1 }}
            >
              {rowNodes.map((nodeRow, ri) => (
                <Box
                  key={ri}
                  sx={{
                    borderRadius: 2,
                    border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                    bgcolor: isDark
                      ? alpha(theme.palette.background.paper, 0.4)
                      : alpha(theme.palette.background.paper, 0.9),
                    overflow: "hidden",
                    transition: "box-shadow 0.2s",
                    "&:hover": {
                      boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.1)}`,
                    },
                  }}
                >
                  {headers.map((h, ci) => (
                    <Box
                      key={ci}
                      sx={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 1,
                        px: 1.5,
                        py: 0.5,
                        ...(ci < headers.length - 1 && {
                          borderBottom: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                        }),
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          minWidth: 72,
                          flexShrink: 0,
                          color: isDark
                            ? theme.palette.primary.light
                            : theme.palette.primary.dark,
                          fontWeight: 600,
                          fontSize: "0.68rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.02em",
                        }}
                      >
                        {h}
                      </Typography>
                      <Typography
                        variant="body2"
                        component="span"
                        sx={{
                          fontSize: "0.8rem",
                          lineHeight: 1.5,
                          wordBreak: "break-word",
                        }}
                      >
                        {nodeRow[ci] ?? "—"}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          );
        }

        // ─── TABLE MODE (≤ 3 columns) ───
        return (
          <Box
            sx={{
              my: 1.5,
              mx: -0.5,
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
              "&::-webkit-scrollbar": { height: 4 },
              "&::-webkit-scrollbar-thumb": {
                bgcolor: alpha(theme.palette.primary.main, 0.2),
                borderRadius: 2,
              },
            }}
          >
            <Box
              component="table"
              sx={{
                width: "100%",
                minWidth: 200,
                borderCollapse: "separate",
                borderSpacing: 0,
                fontSize: "0.78rem",
                lineHeight: 1.4,
                "& th": {
                  bgcolor: alpha(
                    theme.palette.primary.main,
                    isDark ? 0.18 : 0.07,
                  ),
                  fontWeight: 700,
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                  color: isDark
                    ? theme.palette.primary.light
                    : theme.palette.primary.dark,
                  px: 1,
                  py: 0.7,
                  whiteSpace: "nowrap",
                  textAlign: "left",
                  borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                },
                "& td": {
                  px: 1,
                  py: 0.6,
                  textAlign: "left",
                  borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  verticalAlign: "top",
                },
                "& tr:last-child td": { borderBottom: "none" },
                "& tbody tr:hover": {
                  bgcolor: alpha(
                    theme.palette.primary.main,
                    isDark ? 0.08 : 0.03,
                  ),
                },
                "& tr:nth-of-type(even)": {
                  bgcolor: alpha(theme.palette.action.hover, 0.03),
                },
              }}
            >
              {children}
            </Box>
          </Box>
        );
      },
      strong: ({ children }) => (
        <Box
          component="strong"
          sx={{ color: theme.palette.primary.main, fontWeight: 600 }}
        >
          {children}
        </Box>
      ),
      code: ({ children, className }) => {
        if (className) return <code className={className}>{children}</code>;
        return (
          <Box
            component="code"
            sx={{
              px: 0.5,
              py: 0.1,
              borderRadius: 0.5,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              fontSize: "0.8rem",
              fontFamily: "monospace",
            }}
          >
            {children}
          </Box>
        );
      },
      blockquote: ({ children }) => (
        <Box
          sx={{
            borderLeft: `3px solid ${theme.palette.primary.main}`,
            pl: 1.5,
            my: 1,
            py: 0.5,
            bgcolor: alpha(theme.palette.primary.main, 0.05),
            borderRadius: "0 4px 4px 0",
            "& p": { m: 0 },
          }}
        >
          {children}
        </Box>
      ),
      ul: ({ children }) => (
        <Box component="ul" sx={{ pl: 2, my: 0.5, "& li": { mb: 0.3 } }}>
          {children}
        </Box>
      ),
      ol: ({ children }) => (
        <Box component="ol" sx={{ pl: 2, my: 0.5, "& li": { mb: 0.3 } }}>
          {children}
        </Box>
      ),
      p: ({ children }) => (
        <Typography
          variant="body2"
          sx={{ mb: 0.5, lineHeight: 1.6, "&:last-child": { mb: 0 } }}
        >
          {children}
        </Typography>
      ),
    }),
    [theme, isDark, navigate, onLinkClick],
  );

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});

const ChatComposer = memo(function ChatComposer({
  open,
  isTyping,
  theme,
  t,
  onSend,
  onStop,
  reasoningMode: externalReasoningMode = "auto",
  assistantMode: externalAssistantMode = "balanced",
  verificationMode: externalVerificationMode = "balanced",
  onReasoningModeChange,
  onAssistantModeChange,
  onVerificationModeChange,
}) {
  const isDark = theme.palette.mode === "dark";
  const inputRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [modeMenuAnchorEl, setModeMenuAnchorEl] = useState(null);
  const [reasoningMode, setReasoningMode] = useState(() =>
    externalReasoningMode === "force_reasoner" ? "force_reasoner" : "auto",
  );
  const [assistantMode, setAssistantMode] = useState(() =>
    normalizeAssistantModeValue(externalAssistantMode),
  );
  const [verificationMode, setVerificationMode] = useState(() =>
    normalizeVerificationModeValue(externalVerificationMode),
  );

  const modeMenuOpen = Boolean(modeMenuAnchorEl);
  const assistantModeMeta = getAssistantModeMeta(assistantMode, t);
  const verificationModeMeta = getVerificationModeMeta(verificationMode, t);

  useEffect(() => {
    setReasoningMode(
      externalReasoningMode === "force_reasoner" ? "force_reasoner" : "auto",
    );
  }, [externalReasoningMode]);

  useEffect(() => {
    setAssistantMode(normalizeAssistantModeValue(externalAssistantMode));
  }, [externalAssistantMode]);

  useEffect(() => {
    setVerificationMode(normalizeVerificationModeValue(externalVerificationMode));
  }, [externalVerificationMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REASONING_MODE_STORAGE_KEY, reasoningMode);
  }, [reasoningMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextMode = normalizeAssistantModeValue(assistantMode);
    if (nextMode === "balanced") {
      window.localStorage.removeItem(ASSISTANT_MODE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ASSISTANT_MODE_STORAGE_KEY, nextMode);
  }, [assistantMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextMode = normalizeVerificationModeValue(verificationMode);
    if (nextMode === "balanced") {
      window.localStorage.removeItem(VERIFICATION_MODE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(VERIFICATION_MODE_STORAGE_KEY, nextMode);
  }, [verificationMode]);

  useEffect(() => {
    onReasoningModeChange?.(reasoningMode);
  }, [onReasoningModeChange, reasoningMode]);

  useEffect(() => {
    onAssistantModeChange?.(assistantMode);
  }, [assistantMode, onAssistantModeChange]);

  useEffect(() => {
    onVerificationModeChange?.(verificationMode);
  }, [onVerificationModeChange, verificationMode]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 300);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleComposerSend = useCallback(() => {
    const text = draft.trim();
    if (!text || isTyping) return;
    setDraft("");
    void onSend(text, reasoningMode, assistantMode, verificationMode);
  }, [assistantMode, draft, isTyping, onSend, reasoningMode, verificationMode]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleComposerSend();
      }
    },
    [handleComposerSend],
  );

  return (
    <>
      <Box
        sx={{
          p: 1.5,
          pt: 1.2,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          gap: 1.1,
          bgcolor: isDark
            ? alpha(theme.palette.background.paper, 0.6)
            : "#fff",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1 }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={3}
            size="small"
            placeholder={t("chatbot.inputPlaceholder")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: 3,
                minHeight: 44,
                alignItems: "center",
                bgcolor: isDark
                  ? alpha(theme.palette.background.default, 0.5)
                  : alpha(theme.palette.grey[100], 0.8),
                fontSize: "0.875rem",
                py: 0.25,
                "& fieldset": { borderColor: "transparent" },
                "&:hover fieldset": {
                  borderColor: alpha(theme.palette.primary.main, 0.3),
                },
                "&.Mui-focused fieldset": {
                  borderColor: theme.palette.primary.main,
                  borderWidth: 1,
                },
              },
            }}
          />

          <IconButton
            onClick={isTyping ? onStop : handleComposerSend}
            disabled={isTyping ? false : !draft.trim()}
            sx={{
              bgcolor: isTyping
                ? theme.palette.error.main
                : theme.palette.primary.main,
              color: "#fff",
              width: 44,
              height: 44,
              flexShrink: 0,
              "&:hover": {
                bgcolor: isTyping
                  ? theme.palette.error.dark
                  : theme.palette.primary.dark,
              },
              "&.Mui-disabled": {
                bgcolor: alpha(theme.palette.primary.main, 0.3),
                color: "rgba(255,255,255,0.5)",
              },
            }}
          >
            {isTyping ? (
              <StopCircleIcon sx={{ fontSize: 20 }} />
            ) : (
              <SendIcon sx={{ fontSize: 20 }} />
            )}
          </IconButton>
        </Box>

        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              minWidth: 0,
              flexWrap: "wrap",
            }}
          >
            <Tooltip
              title={t("chatbot.reasoner.modeLabel", {}, "Chế độ trả lời")}
            >
              <IconButton
                onClick={(event) => setModeMenuAnchorEl(event.currentTarget)}
                sx={{
                  width: 34,
                  height: 34,
                  border: `1px solid ${alpha(theme.palette.divider, 0.24)}`,
                  bgcolor: isDark
                    ? alpha(theme.palette.background.default, 0.7)
                    : alpha(theme.palette.grey[100], 0.92),
                  color:
                    reasoningMode === "force_reasoner"
                      ? theme.palette.primary.main
                      : theme.palette.text.secondary,
                  "&:hover": {
                    bgcolor: isDark
                      ? alpha(theme.palette.background.default, 0.92)
                      : "#fff",
                  },
                }}
              >
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            {reasoningMode === "force_reasoner" ? (
              <Tooltip
                title={t("chatbot.reasoner.forceMode", {}, "Suy luận")}
              >
                <IconButton
                  size="small"
                  onClick={() => setReasoningMode("auto")}
                  sx={{
                    width: 32,
                    height: 32,
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    color: theme.palette.primary.main,
                  }}
                >
                  <PsychologyIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
            ) : null}

            {assistantMode !== "balanced" ? (
              <Tooltip title={assistantModeMeta.label}>
                <IconButton
                  size="small"
                  onClick={() => setAssistantMode("balanced")}
                  sx={{
                    width: 32,
                    height: 32,
                    border: `1px solid ${alpha(theme.palette.secondary.main, 0.24)}`,
                    bgcolor: alpha(theme.palette.secondary.main, 0.08),
                    color: theme.palette.secondary.main,
                  }}
                >
                  {assistantModeMeta.icon}
                </IconButton>
              </Tooltip>
            ) : null}

            {verificationMode === "strict" ? (
              <Tooltip title={verificationModeMeta.label}>
                <IconButton
                  size="small"
                  onClick={() => setVerificationMode("balanced")}
                  sx={{
                    width: 32,
                    height: 32,
                    border: `1px solid ${alpha(theme.palette.success.main, 0.24)}`,
                    bgcolor: alpha(theme.palette.success.main, 0.08),
                    color: theme.palette.success.main,
                  }}
                >
                  {verificationModeMeta.icon}
                </IconButton>
              </Tooltip>
            ) : null}
          </Box>
        </Box>
      </Box>

      <Menu
        anchorEl={modeMenuAnchorEl}
        open={modeMenuOpen}
        onClose={() => setModeMenuAnchorEl(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        PaperProps={{
          sx: {
            borderRadius: 3,
            minWidth: 220,
            mt: -0.5,
            boxShadow: `0 18px 42px ${alpha("#000", 0.18)}`,
          },
        }}
      >
        <MenuItem
          selected={reasoningMode === "auto"}
          onClick={() => {
            setReasoningMode("auto");
            setModeMenuAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {reasoningMode === "auto" ? (
              <DoneRoundedIcon color="primary" fontSize="small" />
            ) : (
              <AutoAwesomeIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={t("chatbot.reasoner.autoMode", {}, "Tự động")}
          />
        </MenuItem>
        <MenuItem
          selected={reasoningMode === "force_reasoner"}
          onClick={() => {
            setReasoningMode("force_reasoner");
            setModeMenuAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {reasoningMode === "force_reasoner" ? (
              <DoneRoundedIcon color="primary" fontSize="small" />
            ) : (
              <PsychologyIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={t("chatbot.reasoner.forceMode", {}, "Suy luận")}
          />
        </MenuItem>
        <Divider />
        <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
            {t("chatbot.assistantMode.modeLabel", {}, "Phong cách trợ lý")}
          </Typography>
        </Box>
        {["balanced", "operator", "analyst"].map((modeValue) => {
          const option = getAssistantModeMeta(modeValue, t);
          return (
            <MenuItem
              key={modeValue}
              selected={assistantMode === modeValue}
              onClick={() => {
                setAssistantMode(modeValue);
                setModeMenuAnchorEl(null);
              }}
            >
              <ListItemIcon>
                {assistantMode === modeValue ? (
                  <DoneRoundedIcon color="primary" fontSize="small" />
                ) : (
                  option.icon
                )}
              </ListItemIcon>
              <ListItemText
                primary={option.label}
                secondary={option.description}
              />
            </MenuItem>
          );
        })}
        <Divider />
        <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
          <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
            {t("chatbot.verificationMode.modeLabel", {}, "Chế độ xác minh")}
          </Typography>
        </Box>
        {["balanced", "strict"].map((modeValue) => {
          const option = getVerificationModeMeta(modeValue, t);
          return (
            <MenuItem
              key={`verification-${modeValue}`}
              selected={verificationMode === modeValue}
              onClick={() => {
                setVerificationMode(modeValue);
                setModeMenuAnchorEl(null);
              }}
            >
              <ListItemIcon>
                {verificationMode === modeValue ? (
                  <DoneRoundedIcon color="primary" fontSize="small" />
                ) : (
                  option.icon
                )}
              </ListItemIcon>
              <ListItemText
                primary={option.label}
                secondary={option.description}
              />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
});

// ═══════════════════════════════════════════
//  Thinking Block (collapsible, giống Claude)
// ═══════════════════════════════════════════
const ThinkingBlock = memo(function ThinkingBlock({
  steps,
  theme,
  isActive,
  processingTime,
  trustMeta,
  t,
}) {
  const [expanded, setExpanded] = useState(isActive);
  const wasActiveRef = useRef(isActive);

  // Track if this block was ever active (live stream)
  useEffect(() => {
    if (isActive) wasActiveRef.current = true;
  }, [isActive]);

  // Auto-collapse only when transitioning from active → done (not on history load)
  useEffect(() => {
    if (!isActive && wasActiveRef.current && steps.length > 0) {
      const t = setTimeout(() => setExpanded(false), 1000);
      return () => clearTimeout(t);
    }
  }, [isActive, steps.length]);

  if (steps.length === 0 && !isActive) return null;

  return (
    <Box sx={{ mb: 1 }}>
      {/* Toggle header */}
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          px: 1,
          py: 0.3,
          borderRadius: 1,
          "&:hover": {
            bgcolor: alpha(theme.palette.primary.main, 0.05),
          },
        }}
      >
        {isActive ? (
          <CircularProgress
            size={14}
            thickness={5}
            sx={{ color: theme.palette.primary.main }}
          />
        ) : (
          <CheckCircleOutlineIcon
            sx={{ fontSize: 14, color: theme.palette.success.main }}
          />
        )}
        <Typography
          variant="caption"
          sx={{
            fontSize: "0.7rem",
            fontWeight: 600,
            color: isActive
              ? theme.palette.primary.main
              : theme.palette.success.main,
            flex: 1,
          }}
        >
          {isActive
            ? t("chatbot.thinking.active")
            : processingTime
              ? t("chatbot.thinking.doneWithDuration", {
                  seconds: (processingTime / 1000).toFixed(1),
                })
              : t("chatbot.thinking.done")}
        </Typography>
        {!isActive && trustMeta?.confidenceLevel ? (
          <Chip
            size="small"
            label={
              trustMeta.confidenceLevel === "strong"
                ? t("chatbot.trust.strong", {}, "Đối chiếu tốt")
                : trustMeta.confidenceLevel === "grounded"
                  ? t("chatbot.trust.grounded", {}, "Có nguồn")
                  : trustMeta.confidenceLevel === "limited"
                    ? t("chatbot.trust.limited", {}, "Cần kiểm tra")
                    : trustMeta.confidenceLevel === "assisted"
                      ? t("chatbot.trust.assisted", {}, "Có hỗ trợ")
                      : t("chatbot.trust.fast", {}, "Phản hồi nhanh")
            }
            sx={{
              height: 22,
              fontWeight: 700,
              bgcolor: alpha(
                trustMeta.confidenceLevel === "limited"
                  ? theme.palette.warning.main
                  : theme.palette.info.main,
                0.1,
              ),
              color:
                trustMeta.confidenceLevel === "limited"
                  ? theme.palette.warning.main
                  : theme.palette.info.main,
              "& .MuiChip-label": {
                px: 0.9,
              },
            }}
          />
        ) : null}
        {expanded ? (
          <ExpandLessIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 16, color: "text.disabled" }} />
        )}
      </Box>

      {/* Steps list */}
      <Collapse in={expanded}>
        <Box
          sx={{
            ml: 1,
            pl: 1.5,
            borderLeft: `2px solid ${alpha(
              isActive
                ? theme.palette.primary.main
                : theme.palette.success.main,
              0.3,
            )}`,
            mt: 0.3,
          }}
        >
          {steps.map((step, i) => (
            <Box
              key={i}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                py: 0.2,
              }}
            >
              {step.status === "running" ? (
                <CircularProgress
                  size={10}
                  thickness={5}
                  sx={{ color: theme.palette.primary.main }}
                />
              ) : (
                <CheckCircleOutlineIcon
                  sx={{
                    fontSize: 12,
                    color: step.error
                      ? theme.palette.error.main
                      : theme.palette.success.main,
                  }}
                />
              )}
              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.68rem",
                  color: theme.palette.text.secondary,
                  lineHeight: 1.3,
                }}
              >
                {step.label}
                {step.durationMs != null && (
                  <Box
                    component="span"
                    sx={{ color: "text.disabled", ml: 0.5 }}
                  >
                    ({step.durationMs}ms)
                  </Box>
                )}
              </Typography>
            </Box>
          ))}
          {!isActive && trustMeta ? (
            <TrustStrip trustMeta={trustMeta} theme={theme} t={t} embedded />
          ) : null}
        </Box>
      </Collapse>
    </Box>
  );
});

const ReasonerDialog = memo(function ReasonerDialog({
  open,
  message,
  onClose,
  theme,
  t,
}) {
  const [tab, setTab] = useState(0);
  const rawThinking = String(message?.rawThinking || "").trim();
  const summaryText = rawThinking
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  useEffect(() => {
    if (open) setTab(0);
  }, [open, message?.id]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      PaperProps={{
        sx: {
          borderRadius: 3,
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, fontWeight: 800 }}>
        {t("chatbot.reasoner.title")}
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <Tabs
          value={tab}
          onChange={(_event, nextValue) => setTab(nextValue)}
          sx={{ mb: 2 }}
        >
          <Tab label={t("chatbot.reasoner.summaryTab")} />
          <Tab label={t("chatbot.reasoner.rawTab")} />
        </Tabs>

        {tab === 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {message?.thinkingSteps?.length > 0 ? (
              <Box
                sx={{
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
                  p: 1.5,
                }}
              >
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  {t("chatbot.reasoner.timelineTitle")}
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.8 }}>
                  {message.thinkingSteps.map((step, index) => (
                    <Box
                      key={`reason-step-${index}`}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                      }}
                    >
                      {step.status === "running" ? (
                        <CircularProgress size={12} thickness={5} />
                      ) : (
                        <CheckCircleOutlineIcon
                          sx={{
                            fontSize: 14,
                            color: step.error
                              ? theme.palette.error.main
                              : theme.palette.success.main,
                          }}
                        />
                      )}
                      <Typography variant="body2" color="text.secondary">
                        {step.label}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : null}

            <Box
              sx={{
                borderRadius: 2,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                p: 1.75,
              }}
            >
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                {t("chatbot.reasoner.summaryTitle")}
              </Typography>
              <Typography
                variant="body2"
                sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}
              >
                {summaryText || t("chatbot.reasoner.noThinking")}
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.divider, 0.18)}`,
              bgcolor: alpha(theme.palette.background.default, 0.55),
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily:
                'ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
              fontSize: "0.82rem",
              lineHeight: 1.65,
              minHeight: 180,
            }}
          >
            {rawThinking
              ? `<think>\n${rawThinking}\n</think>`
              : t("chatbot.reasoner.noRaw")}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t("common.actions.close")}</Button>
      </DialogActions>
    </Dialog>
  );
});

// ═══════════════════════════════════════════
//  Message Bubble
// ═══════════════════════════════════════════
const AnswerCards = memo(function AnswerCards({ cards, theme, onAction }) {
  if (!Array.isArray(cards) || cards.length === 0) return null;

  return (
    <Box sx={{ display: "grid", gap: 0.9, mt: 0.9, minWidth: 0 }}>
      {cards.slice(0, 2).map((card, index) => (
        <Box
          key={`${card.kind || "card"}-${card.path || card.title || index}`}
          sx={{
            px: 1.3,
            py: 1.15,
            minWidth: 0,
            overflow: "hidden",
            borderRadius: 3,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.14)}`,
            bgcolor: alpha(theme.palette.primary.main, 0.045),
          }}
        >
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.6, mb: 0.7 }}>
            {card.kind ? (
              <Chip
                size="small"
                label={String(card.kind).replaceAll("_", " ")}
                sx={{
                  height: 22,
                  fontWeight: 700,
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: theme.palette.primary.main,
                }}
              />
            ) : null}
            {(card.badges || []).slice(0, 3).map((badge) => (
              <Chip key={`${card.title}-${badge}`} size="small" variant="outlined" label={badge} />
            ))}
          </Box>
          <Typography
            variant="body2"
            fontWeight={800}
            sx={{ lineHeight: 1.45, wordBreak: "break-word" }}
          >
            {card.title}
          </Typography>
          {card.subtitle ? (
            <Typography
              variant="caption"
              sx={{
                display: "block",
                mt: 0.35,
                color: "text.secondary",
                wordBreak: "break-word",
              }}
            >
              {card.subtitle}
            </Typography>
          ) : null}
          {(card.metrics || []).length ? (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.7, mt: 0.9 }}>
              {card.metrics.slice(0, 4).map((metric) => (
                <Chip
                  key={`${card.title}-${metric}`}
                  size="small"
                  label={metric}
                  sx={{
                    maxWidth: "100%",
                    "& .MuiChip-label": {
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    },
                  }}
                />
              ))}
            </Box>
          ) : null}
          {card.description ? (
            <Typography
              variant="body2"
              sx={{
                mt: 0.9,
                color: "text.secondary",
                lineHeight: 1.6,
                wordBreak: "break-word",
              }}
            >
              {card.description}
            </Typography>
          ) : null}
          {Array.isArray(card.actions) && card.actions.length > 0 ? (
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: 0.7,
                mt: 0.9,
                minWidth: 0,
              }}
            >
              {card.actions.slice(0, 2).map((action, actionIndex) => (
                <Button
                  key={`${card.title}-${action.type}-${action.path || action.label || actionIndex}`}
                  size="small"
                  variant={actionIndex === 0 ? "contained" : "outlined"}
                  onClick={() => onAction?.(action)}
                  sx={{
                    borderRadius: 999,
                    textTransform: "none",
                    fontWeight: 700,
                    maxWidth: "100%",
                    minWidth: 0,
                    whiteSpace: "normal",
                    wordBreak: "break-word",
                    lineHeight: 1.2,
                    textAlign: "left",
                    justifyContent: "flex-start",
                  }}
                >
                  {action.label || "Mở"}
                </Button>
              ))}
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
});

const SourcesBar = memo(function SourcesBar({ sources, theme, onAction, t }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;

  return (
    <Box
      sx={{
        mt: 0.9,
        px: 1.15,
        py: 1,
        minWidth: 0,
        overflow: "hidden",
        borderRadius: 2.5,
        bgcolor: alpha(theme.palette.success.main, 0.06),
        border: `1px solid ${alpha(theme.palette.success.main, 0.16)}`,
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: "block",
          mb: 0.55,
          fontWeight: 800,
          color: theme.palette.success.main,
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        {t("chatbot.sourcesTitle", { defaultValue: "Nguồn dữ liệu" })}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.7, minWidth: 0 }}>
        {sources.slice(0, 4).map((source, index) => (
          <Button
            key={`${source.tool || "source"}-${source.entityId || source.path || index}`}
            size="small"
            variant="outlined"
            startIcon={<LinkRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={() =>
              onAction?.(
                source.path
                  ? { type: "navigate", path: source.path, label: source.label }
                  : source.url
                    ? { type: "open_new_tab", path: source.url, label: source.label }
                    : { type: "copy_text", value: source.label, label: source.label },
              )
            }
            sx={{
              borderRadius: 999,
              textTransform: "none",
              fontWeight: 700,
              minHeight: 30,
              px: 1.2,
              maxWidth: "100%",
              minWidth: 0,
              whiteSpace: "normal",
              wordBreak: "break-word",
              lineHeight: 1.2,
              textAlign: "left",
              justifyContent: "flex-start",
            }}
          >
            {source.label}
          </Button>
        ))}
      </Box>
    </Box>
  );
});

const TrustStrip = memo(function TrustStrip({
  trustMeta,
  theme,
  t,
  embedded = false,
}) {
  const { language } = useLanguage();
  if (!trustMeta) return null;
  const isEnglish = String(language || "").toLowerCase().startsWith("en");
  const confidenceLabel =
    trustMeta.confidenceLevel === "strong"
      ? isEnglish
        ? "Cross-checked"
        : "Đã đối chiếu nguồn thật"
      : trustMeta.confidenceLevel === "grounded"
        ? isEnglish
          ? "Grounded data"
          : "Có nguồn dữ liệu thật"
        : trustMeta.confidenceLevel === "limited"
          ? isEnglish
            ? "Needs verification"
            : "Cần kiểm tra thêm"
          : trustMeta.confidenceLevel === "assisted"
            ? isEnglish
              ? "Assisted data"
              : "Có dữ liệu hỗ trợ"
            : isEnglish
              ? "Fast response"
              : "Phản hồi nhanh";
  const explanation = trustMeta.grounded
    ? isEnglish
      ? `This reply is grounded on ${trustMeta.sourceCount || 1} real source${trustMeta.sourceCount > 1 ? "s" : ""} from the app or retrieved content.${trustMeta.reasoned ? " Pikora also used reasoning to synthesize them." : ""}`
      : `Câu trả lời này đang bám ${trustMeta.sourceCount || 1} nguồn dữ liệu thật từ app hoặc nội dung đã tra cứu.${trustMeta.reasoned ? " Pikora cũng dùng suy luận để tổng hợp chúng." : ""}`
    : trustMeta.needsDisclaimer
      ? isEnglish
        ? "This reply used tools, but the grounding is still too thin to treat it as a hard fact."
        : "Câu trả lời này có dùng tool, nhưng lớp grounding vẫn còn mỏng nên chưa nên xem như fact cứng."
      : trustMeta.actionable
        ? isEnglish
          ? "This reply is optimized for the next safe action on the current page."
          : "Câu trả lời này đang tối ưu cho bước thao tác an toàn tiếp theo trên màn hiện tại."
        : isEnglish
          ? "This is a fast answer based on the current context and available signals."
          : "Đây là phản hồi nhanh dựa trên ngữ cảnh hiện tại và các tín hiệu sẵn có.";

  const tone =
    trustMeta.confidenceLevel === "strong" ||
    trustMeta.confidenceLevel === "grounded"
      ? theme.palette.success.main
      : trustMeta.confidenceLevel === "limited"
        ? theme.palette.warning.main
        : theme.palette.info.main;

  return (
    <Box
      sx={{
        mt: embedded ? 0.8 : 0.9,
        px: 1.15,
        py: 1,
        minWidth: 0,
        overflow: "hidden",
        borderRadius: 2.5,
        bgcolor: alpha(tone, 0.06),
        border: `1px solid ${alpha(tone, 0.16)}`,
      }}
    >
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.7, alignItems: "center" }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 800,
            color: tone,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
          }}
        >
          {t(
            "chatbot.trust.title",
            {},
            isEnglish ? "Trust signals" : "Độ tin cậy",
          )}
        </Typography>
        {confidenceLabel ? (
          <Chip
            size="small"
            label={confidenceLabel}
            sx={{
              height: 22,
              fontWeight: 700,
              bgcolor: alpha(tone, 0.1),
              color: tone,
            }}
          />
        ) : null}
        {trustMeta.grounded ? (
          <Chip
            size="small"
            variant="outlined"
            label={t(
              "chatbot.trust.grounded",
              {},
              isEnglish ? "Grounded" : "Có nguồn",
            )}
          />
        ) : null}
        {trustMeta.reasoned ? (
          <Chip
            size="small"
            variant="outlined"
            label={t(
              "chatbot.trust.reasoned",
              {},
              isEnglish ? "Reasoned" : "Có suy luận",
            )}
          />
        ) : null}
        {trustMeta.actionable ? (
          <Chip
            size="small"
            variant="outlined"
            label={t(
              "chatbot.trust.actionable",
              {},
              isEnglish ? "Action ready" : "Có thể thao tác",
            )}
          />
        ) : null}
      </Box>
      {explanation ? (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 0.7,
            color: "text.secondary",
            lineHeight: 1.55,
            wordBreak: "break-word",
          }}
        >
          {explanation}
        </Typography>
      ) : null}
    </Box>
  );
});

const FeedbackBar = memo(function FeedbackBar({
  msg,
  theme,
  onFeedback,
  submitting,
  t,
}) {
  if (!msg?.id || msg.role !== "bot" || typeof onFeedback !== "function") return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.7, mt: 0.9 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700 }}>
        {t("chatbot.feedbackHelpful", {}, "Hữu ích?")}
      </Typography>
      <IconButton
        size="small"
        disabled={submitting}
        color={msg.feedback?.value === "positive" ? "success" : "default"}
        onClick={() => onFeedback?.(msg, "positive")}
      >
        <ThumbUpAltOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <IconButton
        size="small"
        disabled={submitting}
        color={msg.feedback?.value === "negative" ? "error" : "default"}
        onClick={() => onFeedback?.(msg, "negative")}
      >
        <ThumbDownAltOutlinedIcon sx={{ fontSize: 18 }} />
      </IconButton>
      {msg.feedback?.reason ? (
        <Chip
          size="small"
          label={msg.feedback.reason}
          sx={{
            height: 22,
            bgcolor: alpha(theme.palette.text.primary, 0.06),
          }}
        />
      ) : null}
    </Box>
  );
});

const MessageBubble = memo(function MessageBubble({
  msg,
  theme,
  onNavigate,
  onAction,
  onRunWorkflow,
  onCommitMutation,
  sessionFocusOverride,
  onPinSessionFocus,
  onDisableSessionFocus,
  onResetSessionFocusOverride,
  onClose,
  onOpenReasoner,
  onFeedback,
  feedbackSubmitting,
  t,
}) {
  const isBot = msg.role === "bot" || msg.role === "assistant";
  const isDark = theme.palette.mode === "dark";
  const isStreaming = Boolean(msg.isStreaming);
  const showReasoning = isBot && msg.reasoningAvailable && !isStreaming;
  const hasThinkingBlock =
    isBot && Array.isArray(msg.thinkingSteps) && msg.thinkingSteps.length > 0 && !msg.isStreaming;
  const workflow = msg.workflow || null;
  const mutationPreview = msg.mutationPreview || null;
  const sessionFocusMeta = isBot ? getSessionFocusMeta(msg.sessionFocus, t) : null;
  const sessionFocusStateMeta = isBot
    ? getSessionFocusStateMeta(msg.sessionFocusState, t)
    : null;
  const currentSessionFocusPinned =
    sessionFocusOverride?.mode === "pin" &&
    sessionFocusMatches(sessionFocusOverride?.sessionFocus, msg.sessionFocus);

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isBot ? "flex-start" : "flex-end",
        mb: 1.5,
        px: 1,
        minWidth: 0,
        overflowX: "hidden",
      }}
    >
      {isBot && (
        <Avatar
          src={BOT_ICON}
          sx={{
            width: 32,
            height: 32,
            mr: 1,
            mt: 0.5,
            bgcolor: alpha(theme.palette.primary.main, 0.15),
          }}
        />
      )}
      <Box sx={{ maxWidth: "85%", minWidth: 0, overflowX: "hidden" }}>
        {/* Thinking block (hiện trên reply) */}
        {hasThinkingBlock && (
          <ThinkingBlock
            steps={msg.thinkingSteps}
            theme={theme}
            isActive={false}
            processingTime={msg.processingTime}
            trustMeta={msg.trustMeta}
            t={t}
          />
        )}

        <Box
          sx={{
            px: 2,
            py: 1.2,
            borderRadius: isBot ? "4px 16px 16px 16px" : "16px 16px 4px 16px",
            bgcolor: isBot
              ? isDark
                ? alpha(theme.palette.primary.main, 0.12)
                : alpha(theme.palette.primary.main, 0.06)
              : theme.palette.primary.main,
            color: isBot ? theme.palette.text.primary : "#fff",
            fontSize: "0.875rem",
            lineHeight: 1.6,
            wordBreak: "break-word",
            boxShadow: isBot
              ? isStreaming
                ? `0 10px 30px ${alpha(theme.palette.primary.main, 0.12)}`
                : "none"
              : `0 2px 8px ${alpha(theme.palette.primary.main, 0.3)}`,
            overflow: "hidden",
            border: isStreaming
              ? `1px solid ${alpha(theme.palette.primary.main, 0.18)}`
              : "none",
            position: "relative",
          }}
        >
          {isBot ? (
            <>
              {sessionFocusMeta ? (
                <Box
                  sx={{
                    mb: 0.9,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 0.7,
                    alignItems: "center",
                  }}
                >
                  <Chip
                    size="small"
                    label={sessionFocusMeta.chipLabel}
                    sx={{
                      maxWidth: "100%",
                      height: 24,
                      bgcolor: alpha(sessionFocusMeta.accent || theme.palette.info.main, 0.1),
                      color: sessionFocusMeta.accent || theme.palette.info.main,
                      fontWeight: 700,
                      border: `1px solid ${alpha(sessionFocusMeta.accent || theme.palette.info.main, 0.16)}`,
                      ".MuiChip-label": {
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        px: 1.1,
                      },
                    }}
                  />
                  <Chip
                    size="small"
                    label={sessionFocusMeta.typeLabel}
                    variant="outlined"
                    sx={{
                      height: 24,
                      fontWeight: 700,
                      color: sessionFocusMeta.accent || theme.palette.info.main,
                      borderColor: alpha(
                        sessionFocusMeta.accent || theme.palette.info.main,
                        0.22,
                      ),
                    }}
                  />
                  {sessionFocusStateMeta ? (
                    <Chip
                      size="small"
                      label={sessionFocusStateMeta.label}
                      variant="outlined"
                      sx={{
                        height: 24,
                        fontWeight: 700,
                        color: sessionFocusStateMeta.accent,
                        borderColor: alpha(sessionFocusStateMeta.accent, 0.22),
                        bgcolor: alpha(sessionFocusStateMeta.accent, 0.06),
                      }}
                    />
                  ) : null}
                  {currentSessionFocusPinned && !sessionFocusStateMeta ? (
                    <Chip
                      size="small"
                      label={t("chatbot.sessionFocus.pinned", {}, "Đã ghim")}
                      color="secondary"
                      variant="outlined"
                      sx={{ height: 24, fontWeight: 700 }}
                    />
                  ) : !currentSessionFocusPinned ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => onPinSessionFocus?.(msg.sessionFocus, msg)}
                      sx={{
                        minWidth: 0,
                        px: 0.4,
                        fontSize: "0.72rem",
                        textTransform: "none",
                        fontWeight: 700,
                      }}
                    >
                      {t("chatbot.sessionFocus.pin", {}, "Ghim")}
                    </Button>
                  ) : null}
                  {sessionFocusOverride?.mode === "off" ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => onResetSessionFocusOverride?.(msg)}
                      sx={{
                        minWidth: 0,
                        px: 0.4,
                        fontSize: "0.72rem",
                        textTransform: "none",
                        fontWeight: 700,
                      }}
                    >
                      {t("chatbot.sessionFocus.auto", {}, "Tự động")}
                    </Button>
                  ) : currentSessionFocusPinned ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => onResetSessionFocusOverride?.(msg)}
                      sx={{
                        minWidth: 0,
                        px: 0.4,
                        fontSize: "0.72rem",
                        textTransform: "none",
                        fontWeight: 700,
                      }}
                    >
                      {t("chatbot.sessionFocus.auto", {}, "Tự động")}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => onDisableSessionFocus?.(msg)}
                      sx={{
                        minWidth: 0,
                        px: 0.4,
                        fontSize: "0.72rem",
                        textTransform: "none",
                        fontWeight: 700,
                      }}
                    >
                      {t("chatbot.sessionFocus.clear", {}, "Bỏ")}
                    </Button>
                  )}
                </Box>
              ) : null}

              {isStreaming ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.8 }}>
                  <Chip
                    size="small"
                    label={t("chatbot.streaming.badge")}
                    sx={{
                      height: 22,
                      fontWeight: 700,
                      fontSize: "0.68rem",
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                      color: theme.palette.primary.main,
                    }}
                  />
                  {msg.reasoningAvailable ? (
                    <Typography
                      variant="caption"
                      sx={{
                        color: theme.palette.text.secondary,
                        fontWeight: 600,
                      }}
                    >
                      {t("chatbot.streaming.reasoning")}
                    </Typography>
                  ) : null}
                </Box>
              ) : null}

              {isStreaming ? (
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.7,
                    minHeight: 22,
                  }}
                >
                  {msg.text || t("chatbot.processing")}
                  <Box
                    component="span"
                    sx={{
                      display: "inline-block",
                      width: 8,
                      height: "1.05em",
                      ml: 0.35,
                      borderRadius: 0.5,
                      bgcolor: theme.palette.primary.main,
                      verticalAlign: "text-bottom",
                      animation: "pikoraStreamCursor 1s steps(1) infinite",
                      "@keyframes pikoraStreamCursor": {
                        "0%, 45%": { opacity: 1 },
                        "46%, 100%": { opacity: 0 },
                      },
                    }}
                  />
                </Typography>
              ) : (
                <MarkdownContent
                  text={msg.text}
                  theme={theme}
                  onLinkClick={onClose}
                />
              )}
            </>
          ) : (
            msg.text
          )}
        </Box>

        {showReasoning ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 0.8 }}>
            <Chip
              size="small"
              icon={<PsychologyIcon sx={{ fontSize: 14 }} />}
              label={t("chatbot.reasoner.badge")}
              sx={{
                height: 24,
                fontWeight: 700,
                bgcolor: alpha(theme.palette.primary.main, 0.08),
                color: theme.palette.primary.main,
              }}
            />
            <Box
              onClick={() => onOpenReasoner?.(msg)}
              sx={{
                fontSize: "0.76rem",
                fontWeight: 700,
                color: theme.palette.primary.main,
                cursor: "pointer",
                "&:hover": { textDecoration: "underline" },
              }}
            >
              {t("chatbot.reasoner.open")}
            </Box>
          </Box>
        ) : null}

        {isBot && msg.trustMeta && !hasThinkingBlock ? (
          <TrustStrip trustMeta={msg.trustMeta} theme={theme} t={t} />
        ) : null}

        {isBot && Array.isArray(msg.answerCards) && msg.answerCards.length > 0 ? (
          <AnswerCards
            cards={msg.answerCards}
            theme={theme}
            onAction={(action) => onAction?.(action, msg)}
          />
        ) : null}

        {isBot && Array.isArray(msg.sources) && msg.sources.length > 0 ? (
          <SourcesBar
            sources={msg.sources}
            theme={theme}
            onAction={(action) => onAction?.(action, msg)}
            t={t}
          />
        ) : null}

        {isBot && Array.isArray(msg.actions) && msg.actions.length > 0 ? (
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 0.8,
              mt: 0.9,
              minWidth: 0,
            }}
          >
            {msg.actions.slice(0, 4).map((action, index) => (
              <Button
                key={`${action.type || "action"}-${action.path || action.value || index}`}
                size="small"
                variant={index === 0 ? "contained" : "outlined"}
                color={index === 0 ? "primary" : "inherit"}
                startIcon={
                  action.type === "copy_link" || action.type === "copy_current_url" ? (
                    <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                  ) : (
                    <OpenInNewIcon sx={{ fontSize: 14 }} />
                  )
                }
                onClick={() => onAction?.(action, msg)}
                sx={{
                  borderRadius: 999,
                  textTransform: "none",
                  fontWeight: 700,
                  minHeight: 32,
                  px: 1.4,
                  maxWidth: "100%",
                  minWidth: 0,
                  whiteSpace: "normal",
                  wordBreak: "break-word",
                  lineHeight: 1.2,
                  textAlign: "left",
                  justifyContent: "flex-start",
                }}
              >
                {getChatActionLabel(action, t)}
              </Button>
            ))}
          </Box>
        ) : null}

        {isBot && workflow?.steps?.length ? (
          <Box
            sx={{
              mt: 1,
              p: 1.2,
              borderRadius: 2.5,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.16)}`,
              bgcolor: alpha(theme.palette.primary.main, 0.04),
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 800, color: theme.palette.text.primary }}
            >
              {workflow.title || "Quy trình an toàn"}
            </Typography>
            {workflow.summary ? (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mt: 0.4,
                  color: theme.palette.text.secondary,
                  lineHeight: 1.45,
                }}
              >
                {workflow.summary}
              </Typography>
            ) : null}
            <Box sx={{ mt: 1, display: "grid", gap: 0.6 }}>
              {workflow.steps.slice(0, 3).map((step, index) => (
                <Box
                  key={step.id || `${msg.id}-workflow-${index}`}
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 0.9,
                    minWidth: 0,
                  }}
                >
                  <Chip
                    size="small"
                    label={index + 1}
                    sx={{
                      height: 22,
                      minWidth: 22,
                      fontWeight: 800,
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                      color: theme.palette.primary.main,
                    }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="caption"
                      sx={{
                        display: "block",
                        fontWeight: 700,
                        color: theme.palette.text.primary,
                        lineHeight: 1.35,
                      }}
                    >
                      {step.title}
                    </Typography>
                    {step.description ? (
                      <Typography
                        variant="caption"
                        sx={{
                          display: "block",
                          color: theme.palette.text.secondary,
                          lineHeight: 1.35,
                        }}
                      >
                        {step.description}
                      </Typography>
                    ) : null}
                  </Box>
                </Box>
              ))}
            </Box>
            <Button
              size="small"
              variant="outlined"
              onClick={() => onRunWorkflow?.(workflow, msg)}
              sx={{
                mt: 1,
                borderRadius: 999,
                textTransform: "none",
                fontWeight: 700,
              }}
            >
              {workflow.runLabel || "Chạy workflow"}
            </Button>
          </Box>
        ) : null}

        {isBot && mutationPreview?.type ? (
          <Box
            sx={{
              mt: 1,
              p: 1.2,
              borderRadius: 2.5,
              border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
              bgcolor: alpha(theme.palette.warning.main, 0.06),
            }}
          >
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: 800, color: theme.palette.text.primary }}
            >
              {mutationPreview.title || "Thay đổi nhẹ có xác nhận"}
            </Typography>
            {mutationPreview.summary ? (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mt: 0.4,
                  color: theme.palette.text.secondary,
                  lineHeight: 1.45,
                }}
              >
                {mutationPreview.summary}
              </Typography>
            ) : null}
            {Array.isArray(mutationPreview.changes) &&
            mutationPreview.changes.length ? (
              <Box sx={{ mt: 0.8, display: "grid", gap: 0.35 }}>
                {mutationPreview.changes.slice(0, 3).map((change, index) => (
                  <Typography
                    key={`${msg.id}-mutation-change-${index}`}
                    variant="caption"
                    sx={{ color: theme.palette.text.secondary }}
                  >
                    • {change}
                  </Typography>
                ))}
              </Box>
            ) : null}
            <Button
              size="small"
              variant="outlined"
              color="warning"
              onClick={() => onCommitMutation?.(mutationPreview, msg)}
              sx={{
                mt: 1,
                borderRadius: 999,
                textTransform: "none",
                fontWeight: 700,
              }}
            >
              {"Xác nhận thay đổi nhẹ"}
            </Button>
          </Box>
        ) : null}

        {isBot && Array.isArray(msg.toolSummary) && msg.toolSummary.length > 0 ? (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.7, mt: 0.9 }}>
            {msg.toolSummary.slice(0, 3).map((item) => (
              <Chip
                key={`${item.tool}-${item.resultPreview}`}
                size="small"
                label={item.resultPreview || item.label || item.tool}
                sx={{
                  maxWidth: "100%",
                  "& .MuiChip-label": {
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  },
                }}
              />
            ))}
          </Box>
        ) : null}

        {isBot && msg.interrupted && !isStreaming ? (
          <Typography
            variant="caption"
            sx={{
              display: "block",
              mt: 0.7,
              color: theme.palette.warning.main,
              fontWeight: 700,
            }}
          >
            {t("chatbot.streaming.interrupted")}
          </Typography>
        ) : null}

        <FeedbackBar
          msg={msg}
          theme={theme}
          onFeedback={onFeedback}
          submitting={feedbackSubmitting}
          t={t}
        />

        {/* Navigation button */}
        {isBot && msg.navigation?.webPath && (
          <Box
            onClick={() => onNavigate?.(msg.navigation.webPath)}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              mt: 0.8,
              px: 1.5,
              py: 0.6,
              maxWidth: "100%",
              minWidth: 0,
              borderRadius: 2,
              cursor: "pointer",
              fontSize: "0.78rem",
              fontWeight: 600,
              wordBreak: "break-word",
              color: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
              transition: "all 0.2s ease",
              "&:hover": {
                bgcolor: alpha(theme.palette.primary.main, 0.15),
                transform: "translateY(-1px)",
                boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.2)}`,
              },
            }}
          >
            <OpenInNewIcon sx={{ fontSize: 14 }} />
            {msg.navigation.description || t("chatbot.navigationOpen")}
          </Box>
        )}
      </Box>
    </Box>
  );
});

// ═══════════════════════════════════════════
//  Active Thinking Indicator (live streaming)
// ═══════════════════════════════════════════
const LiveThinking = memo(function LiveThinking({ theme, steps, t }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", px: 1, mb: 1.5 }}>
      <Avatar
        src={BOT_ICON}
        sx={{
          width: 32,
          height: 32,
          mr: 1,
          bgcolor: alpha(theme.palette.primary.main, 0.15),
        }}
      />
      <Box sx={{ maxWidth: "85%", minWidth: 120 }}>
        <ThinkingBlock steps={steps} theme={theme} isActive={true} t={t} />
      </Box>
    </Box>
  );
});

// ═══════════════════════════════════════════
//  SSE Stream Parser
// ═══════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
async function legacySendMessageStream(message, onEvent, signal) {
  const base = import.meta.env.VITE_API_URL || "";

  // ── Extract context from current URL path ──
  const pathname = window.location.pathname;
  const headers = { "Content-Type": "application/json" };

  // /tournament/:id/... → tournamentId
  const tourMatch = pathname.match(/\/tournament\/([a-f0-9]{24})/i);
  if (tourMatch) headers["x-pkt-tournament-id"] = tourMatch[1];

  // /brackets/:bracketId/... → bracketId
  const bracketMatch = pathname.match(/\/brackets?\/([a-f0-9]{24})/i);
  if (bracketMatch) headers["x-pkt-bracket-id"] = bracketMatch[1];

  // /live/:tid/brackets/:bid/live-studio/:courtId → courtId
  const courtMatch = pathname.match(
    /\/(?:streaming|live-studio)\/([a-f0-9]{24})/i,
  );
  if (courtMatch) headers["x-pkt-court-id"] = courtMatch[1];

  // Always send current path for context
  headers["x-pkt-current-path"] = pathname;

  const res = await fetch(`${base}/api/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (done) break;
    const { value } = chunk;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent(currentEvent, data);
        } catch {
          // ignore parse errors
        }
        currentEvent = "";
      }
    }
  }
}

// ═══════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════
function setContextHeader(headers, key, value) {
  const text = String(value ?? "").trim();
  if (text) headers[key] = encodeURIComponent(text);
}

function buildChatContextHeaders() {
  const headers = { "Content-Type": "application/json" };
  const currentUrl = new URL(window.location.href);
  const pathname = currentUrl.pathname;
  const search = currentUrl.search || "";
  const searchParams = currentUrl.searchParams;
  const currentPath = `${pathname}${search}`;

  const tournamentId =
    pathname.match(/\/tournament\/([a-f0-9]{24})/i)?.[1] ||
    pathname.match(/\/live\/([a-f0-9]{24})\/brackets\//i)?.[1] ||
    "";
  const bracketId =
    pathname.match(/\/brackets?\/([a-f0-9]{24})/i)?.[1] || "";
  const clubId = pathname.match(/\/clubs\/([a-f0-9]{24})/i)?.[1] || "";
  const newsSlug = pathname.match(/\/news\/([^/?#]+)/i)?.[1] || "";
  const profileUserId =
    pathname.match(/\/user\/([a-f0-9]{24})/i)?.[1] || "";
  const courtId =
    pathname.match(/\/streaming\/([a-f0-9]{24})/i)?.[1] ||
    pathname.match(
      /\/live\/[a-f0-9]{24}\/brackets\/[a-f0-9]{24}\/live-studio\/([a-f0-9]{24})/i,
    )?.[1] ||
    searchParams.get("courtId") ||
    "";
  const matchId = searchParams.get("matchId") || "";
  const courtCode = searchParams.get("courtCode") || "";

  let pageType = "unknown";
  let pageSection = "";
  let pageView = "";
  let adminSection = "";

  if (pathname === "/") {
    pageType = "home";
  } else if (pathname === "/login") {
    pageType = "login";
  } else if (pathname === "/register") {
    pageType = "register";
  } else if (pathname === "/forgot-password") {
    pageType = "forgot_password";
  } else if (pathname.startsWith("/reset-password/")) {
    pageType = "reset_password";
  } else if (pathname === "/oauth/authorize") {
    pageType = "oauth_authorize";
  } else if (pathname === "/pickle-ball/tournaments") {
    pageType = "tournament_list";
  } else if (/^\/tournament\/[a-f0-9]{24}\/register$/i.test(pathname)) {
    pageType = "tournament_registration";
  } else if (/^\/tournament\/[a-f0-9]{24}\/checkin$/i.test(pathname)) {
    pageType = "tournament_checkin";
  } else if (/^\/tournament\/[a-f0-9]{24}\/bracket$/i.test(pathname)) {
    pageType = "tournament_bracket";
    pageView = searchParams.get("tab") || "";
  } else if (/^\/tournament\/[a-f0-9]{24}\/schedule$/i.test(pathname)) {
    pageType = "tournament_schedule";
  } else if (
    /^\/tournament\/[a-f0-9]{24}\/brackets\/[a-f0-9]{24}\/draw$/i.test(pathname)
  ) {
    pageType = "tournament_admin_draw";
  } else if (/^\/tournament\/[a-f0-9]{24}\/draw\/live$/i.test(pathname)) {
    pageType = "tournament_draw_live";
    pageView = searchParams.get("view") || "stage";
  } else if (/^\/tournament\/[a-f0-9]{24}\/draw$/i.test(pathname)) {
    pageType = "tournament_draw_manage";
  } else if (/^\/tournament\/[a-f0-9]{24}\/manage$/i.test(pathname)) {
    pageType = "tournament_manage";
  } else if (/^\/tournament\/[a-f0-9]{24}(\/overview)?$/i.test(pathname)) {
    pageType = "tournament_overview";
  } else if (pathname === "/pickle-ball/rankings") {
    pageType = "leaderboard";
    pageView = searchParams.get("view") || "";
  } else if (pathname === "/news") {
    pageType = "news_list";
    pageView = searchParams.get("page") || "";
  } else if (/^\/news\/[^/?#]+$/i.test(pathname)) {
    pageType = "news_detail";
  } else if (pathname === "/clubs") {
    pageType = "club_list";
  } else if (/^\/clubs\/[a-f0-9]{24}$/i.test(pathname)) {
    pageType = "club_detail";
    pageSection = searchParams.get("tab") || "news";
  } else if (pathname === "/live") {
    pageType = "live_clusters";
  } else if (pathname === "/studio/live") {
    pageType = "live_studio";
  } else if (/^\/streaming\/[a-f0-9]{24}$/i.test(pathname)) {
    pageType = "court_streaming";
  } else if (
    /^\/live\/[a-f0-9]{24}\/brackets\/[a-f0-9]{24}\/live-studio\/[a-f0-9]{24}$/i.test(
      pathname,
    )
  ) {
    pageType = "court_live_studio";
  } else if (pathname === "/profile") {
    pageType = "profile";
  } else if (pathname === "/my-tournaments") {
    pageType = "my_tournaments";
  } else if (/^\/user\/[a-f0-9]{24}$/i.test(pathname)) {
    pageType = "public_profile";
  } else if (pathname === "/contact") {
    pageType = "contact";
  } else if (pathname === "/status") {
    pageType = "status";
  } else if (pathname.startsWith("/admin")) {
    adminSection =
      pathname === "/admin/users"
        ? "users"
        : pathname === "/admin/news"
          ? "news"
          : pathname === "/admin/avatar-optimization"
            ? "avatar-optimization"
            : "home";
    pageType = `admin_${adminSection}`;
    pageSection = adminSection;
  }

  setContextHeader(headers, "x-pkt-current-path", currentPath);
  setContextHeader(headers, "x-pkt-current-url", currentUrl.toString());
  setContextHeader(headers, "x-pkt-page-title", document.title || "");
  setContextHeader(headers, "x-pkt-page-type", pageType);
  setContextHeader(headers, "x-pkt-page-section", pageSection);
  setContextHeader(headers, "x-pkt-page-view", pageView);
  setContextHeader(headers, "x-pkt-admin-section", adminSection);
  setContextHeader(headers, "x-pkt-tournament-id", tournamentId);
  setContextHeader(headers, "x-pkt-bracket-id", bracketId);
  setContextHeader(headers, "x-pkt-club-id", clubId);
  setContextHeader(
    headers,
    "x-pkt-club-tab",
    pageType === "club_detail" ? pageSection : "",
  );
  setContextHeader(headers, "x-pkt-news-slug", newsSlug);
  setContextHeader(headers, "x-pkt-profile-user-id", profileUserId);
  setContextHeader(headers, "x-pkt-court-id", courtId);
  setContextHeader(headers, "x-pkt-match-id", matchId);
  setContextHeader(headers, "x-pkt-court-code", courtCode);

  return headers;
}

async function sendMessageStream(
  message,
  pageSnapshot,
  capabilityKeys,
  reasoningMode,
  assistantMode,
  verificationMode,
  knowledgeMode,
  cohortId,
  sessionFocusOverride,
  onEvent,
  signal,
) {
  const base = import.meta.env.VITE_API_URL || "";
  const headers = buildChatContextHeaders();

  const res = await fetch(`${base}/api/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      pageSnapshot: pageSnapshot || null,
      capabilityKeys: Array.isArray(capabilityKeys) ? capabilityKeys : [],
      reasoningMode: reasoningMode || "auto",
      assistantMode: normalizeAssistantModeValue(assistantMode),
      verificationMode: normalizeVerificationModeValue(verificationMode),
      knowledgeMode: knowledgeMode || "auto",
      cohortId: cohortId || "",
      sessionFocusOverride: normalizeSessionFocusOverrideValue(
        sessionFocusOverride,
      ),
      surface: "web",
    }),
    credentials: "include",
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (done) break;
    const { value } = chunk;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          onEvent(currentEvent, data);
        } catch {
          // ignore parse errors
        }
        currentEvent = "";
      }
    }
  }
}

function getChatActionLabel(action, t) {
  if (!action) return "";
  if (action.label) return action.label;
  switch (action.type) {
    case "navigate":
      return t("chatbot.actions.open");
    case "open_new_tab":
      return t("chatbot.actions.openNewTab");
    case "copy_current_url":
    case "copy_link":
      return t("chatbot.actions.copyLink");
    case "copy_text":
      return t("chatbot.actions.copyText");
    default:
      return t("chatbot.actions.run");
  }
}

function setElementTextValue(selector, value) {
  if (!selector || typeof document === "undefined") return false;
  const el = document.querySelector(selector);
  if (!el) return false;
  el.focus?.();
  if ("value" in el) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  return false;
}

async function runChatAction(action, { navigate, onClose, t, getActionHandler }) {
  if (!action?.type) return;
  const payload = action.payload || {};

  switch (action.type) {
    case "navigate":
      if (action.path) {
        onClose?.();
        navigate(action.path);
      }
      return { status: "executed", detail: action.path || "" };
    case "open_new_tab":
      if (action.path) {
        window.open(action.path, "_blank", "noopener,noreferrer");
      }
      return { status: "executed", detail: action.path || "" };
    case "copy_current_url":
    case "copy_link": {
      const value = action.value || window.location.href;
      await navigator.clipboard.writeText(String(value || ""));
      return { status: "executed", detail: String(value || "") };
    }
    case "copy_text":
      if (action.value) {
        await navigator.clipboard.writeText(String(action.value));
      }
      return { status: "executed", detail: String(action.value || "") };
    case "set_query_param": {
      const nextUrl = new URL(window.location.href);
      const key = payload.key || action.key;
      const value = payload.value ?? action.value;
      if (!key) return;
      if (value === null || value === undefined || value === "") {
        nextUrl.searchParams.delete(key);
      } else {
        nextUrl.searchParams.set(key, value);
      }
      navigate(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      return {
        status: "degraded",
        detail: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
      };
    }
    case "set_page_state": {
      const handlerKey = payload.handlerKey || payload.key || action.key;
      const handler = getActionHandler?.(handlerKey);
      if (typeof handler === "function") {
        await handler(payload.value, payload, action);
        return { status: "executed", detail: handlerKey || "" };
      }
      if (payload.queryParamKey) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set(payload.queryParamKey, payload.value ?? "");
        navigate(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
        return {
          status: "degraded",
          detail: `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
        };
      }
      throw new Error(t("chatbot.actions.unsupported"));
    }
    case "open_dialog": {
      const handler = getActionHandler?.(payload.handlerKey || "openDialog");
      if (typeof handler === "function") {
        await handler(payload.value, payload, action);
        return {
          status: "executed",
          detail: payload.handlerKey || "openDialog",
        };
      }
      throw new Error(t("chatbot.actions.unsupported"));
    }
    case "focus_element": {
      const handlerKey =
        payload.handlerKey || action.handlerKey || "focusSearch";
      const handler = getActionHandler?.(handlerKey);
      if (typeof handler === "function") {
        await handler(undefined, payload, action);
        return { status: "executed", detail: handlerKey };
      }

      const selector = payload.selector || action.selector;
      if (!selector) throw new Error(t("chatbot.actions.unsupported"));
      const el = document.querySelector(selector);
      if (!el) throw new Error(t("chatbot.actions.unsupported"));
      el?.focus?.();
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      return { status: "executed", detail: selector };
    }
    case "scroll_to_section": {
      const selector = payload.selector || action.selector;
      if (!selector) throw new Error(t("chatbot.actions.unsupported"));
      const el = document.querySelector(selector);
      if (!el) throw new Error(t("chatbot.actions.unsupported"));
      el?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return { status: "executed", detail: selector };
    }
    case "prefill_text": {
      const handler = getActionHandler?.(payload.handlerKey || "search");
      if (typeof handler === "function") {
        await handler(payload.value || action.value || "", payload, action);
        return {
          status: "executed",
          detail: payload.handlerKey || "search",
        };
      }
      if (setElementTextValue(payload.selector || action.selector, payload.value || action.value || "")) {
        return {
          status: "degraded",
          detail: payload.selector || action.selector || "",
        };
      }
      throw new Error(t("chatbot.actions.unsupported"));
    }
    default:
      throw new Error(t("chatbot.actions.unsupported"));
  }
}

export default function ChatBotDrawer() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isDark = theme.palette.mode === "dark";
  const routerNavigate = useRouterNavigate();
  const { t } = useLanguage();
  const {
    snapshot: registeredPageSnapshot,
    capabilityKeys,
    getActionHandler,
  } = useChatBotPageContext();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [liveSteps, setLiveSteps] = useState([]);
  const [liveDraft, setLiveDraft] = useState(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dynamicSuggestions, setDynamicSuggestions] = useState([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [reasonerMessage, setReasonerMessage] = useState(null);
  const [pendingActionConfirm, setPendingActionConfirm] = useState(null);
  const [pendingWorkflowConfirm, setPendingWorkflowConfirm] = useState(null);
  const [pendingMutationConfirm, setPendingMutationConfirm] = useState(null);
  const [feedbackDialog, setFeedbackDialog] = useState(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSubmittingId, setFeedbackSubmittingId] = useState("");
  const [modeMenuAnchorEl, setModeMenuAnchorEl] = useState(null);
  const [reasoningMode, setReasoningMode] = useState(() => {
    if (typeof window === "undefined") return "auto";
    return window.localStorage.getItem(REASONING_MODE_STORAGE_KEY) === "force_reasoner"
      ? "force_reasoner"
      : "auto";
  });
  const [assistantMode, setAssistantMode] = useState(() => {
    if (typeof window === "undefined") return "balanced";
    return normalizeAssistantModeValue(
      window.localStorage.getItem(ASSISTANT_MODE_STORAGE_KEY),
    );
  });
  const [verificationMode, setVerificationMode] = useState(() => {
    if (typeof window === "undefined") return "balanced";
    return normalizeVerificationModeValue(
      window.localStorage.getItem(VERIFICATION_MODE_STORAGE_KEY),
    );
  });
  const [sessionFocusOverride, setSessionFocusOverride] = useState(() => {
    if (typeof window === "undefined") {
      return { mode: "auto", sessionFocus: null };
    }
    try {
      return normalizeSessionFocusOverrideValue(
        JSON.parse(
          window.localStorage.getItem(SESSION_FOCUS_OVERRIDE_STORAGE_KEY) ||
            "null",
        ),
      );
    } catch {
      return { mode: "auto", sessionFocus: null };
    }
  });

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const draftFrameRef = useRef(null);
  const composerReasoningModeRef = useRef("auto");
  const composerAssistantModeRef = useRef("balanced");
  const composerVerificationModeRef = useRef("balanced");
  const sessionFocusOverrideRef = useRef({ mode: "auto", sessionFocus: null });
  const liveStepsRef = useRef([]);
  const liveReplyRef = useRef("");
  const liveReasoningRef = useRef("");
  const liveMetaRef = useRef({
    model: null,
    mode: "chat",
    navigation: null,
    actions: [],
    answerCards: [],
    sources: [],
    contextInsight: "",
    personalization: null,
    trustMeta: null,
    reasoningAvailable: false,
    intent: "",
    routeKind: "",
    routeLane: "",
    queryScope: "",
    contextConfidence: "",
    capabilityKeys: [],
    actionExecutionSummary: null,
    workflow: null,
    mutationPreview: null,
    sessionFocus: null,
    sessionFocusState: null,
    assistantMode: "balanced",
    verificationMode: "balanced",
    surface: "web",
    messageId: null,
    firstTokenLatencyMs: null,
    processingTime: null,
    processingTimeMs: null,
  });

  const { userInfo } = useSelector((state) => state.auth);
  const [clearHistory] = useClearChatHistoryMutation();
  const [clearLearning] = useClearLearningMemoryMutation();
  const [sendChatFeedback] = useSendChatFeedbackMutation();
  const [sendChatTelemetryEvent] = useSendChatTelemetryEventMutation();
  const [commitChatMutation] = chatBotApiSlice.useCommitChatMutationMutation();
  const [fetchHistory] = chatBotApiSlice.useLazyGetChatHistoryQuery();
  const historyLoaded = useRef(false);
  const nextCursorRef = useRef(null);
  const hasMoreRef = useRef(true);
  const tipItems = t("chatbot.settings.tips");
  const sessionFocusOverrideMeta = useMemo(() => {
    const normalized = normalizeSessionFocusOverrideValue(sessionFocusOverride);
    if (normalized.mode === "off") {
      return {
        label: t("chatbot.sessionFocus.off", {}, "Ngữ cảnh hội thoại đang tắt"),
        color: "warning",
      };
    }
    if (normalized.mode === "pin") {
      const activeFocus = getActiveSessionFocusEntity(normalized.sessionFocus);
      return {
        label: `${t("chatbot.sessionFocus.pinned", {}, "Đã ghim")}: ${
          activeFocus?.label || t("chatbot.sessionFocus.tracking", {}, "Ngữ cảnh")
        }`,
        color: "secondary",
      };
    }
    return null;
  }, [sessionFocusOverride, t]);

  useEffect(() => {
    composerReasoningModeRef.current =
      reasoningMode === "force_reasoner" ? "force_reasoner" : "auto";
    if (typeof window === "undefined") return;
    if (reasoningMode === "force_reasoner") {
      window.localStorage.setItem(REASONING_MODE_STORAGE_KEY, reasoningMode);
    } else {
      window.localStorage.removeItem(REASONING_MODE_STORAGE_KEY);
    }
  }, [reasoningMode]);

  useEffect(() => {
    const nextMode = normalizeAssistantModeValue(assistantMode);
    composerAssistantModeRef.current = nextMode;
    if (typeof window === "undefined") return;
    if (nextMode === "balanced") {
      window.localStorage.removeItem(ASSISTANT_MODE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ASSISTANT_MODE_STORAGE_KEY, nextMode);
    }
  }, [assistantMode]);

  useEffect(() => {
    const nextMode = normalizeVerificationModeValue(verificationMode);
    composerVerificationModeRef.current = nextMode;
    if (typeof window === "undefined") return;
    if (nextMode === "balanced") {
      window.localStorage.removeItem(VERIFICATION_MODE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(VERIFICATION_MODE_STORAGE_KEY, nextMode);
    }
  }, [verificationMode]);

  useEffect(() => {
    const normalized = normalizeSessionFocusOverrideValue(sessionFocusOverride);
    sessionFocusOverrideRef.current = normalized;
    if (typeof window === "undefined") return;
    if (normalized.mode === "auto") {
      window.localStorage.removeItem(SESSION_FOCUS_OVERRIDE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      SESSION_FOCUS_OVERRIDE_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  }, [sessionFocusOverride]);

  useEffect(
    () => () => {
      if (draftFrameRef.current) {
        cancelAnimationFrame(draftFrameRef.current);
        draftFrameRef.current = null;
      }
    },
    [],
  );

  // ─── Map backend message to frontend format ───
  const mapMessage = useCallback(
    (m) => ({
      id: m.id,
      role: m.role === "user" ? "user" : "bot",
      text: m.message || "",
      toolsUsed: m.meta?.toolsUsed || [],
      processingTime: m.meta?.processingTimeMs || m.meta?.processingTime || null,
      thinkingSteps: m.meta?.thinkingSteps || [],
      navigation: m.navigation || null,
      actions: m.meta?.actions || [],
      answerCards: m.meta?.answerCards || [],
      sources: m.meta?.sources || [],
      intent: m.meta?.intent || "",
      routeKind: m.meta?.routeKind || "",
      routeLane: m.meta?.routeLane || "",
      queryScope: m.meta?.queryScope || "",
      contextConfidence: m.meta?.contextConfidence || "",
      capabilityKeys: m.meta?.capabilityKeys || [],
      actionExecutionSummary: m.meta?.actionExecutionSummary || null,
      workflow: m.meta?.workflow || null,
      mutationPreview: m.meta?.mutationPreview || null,
      sessionFocus: m.meta?.sessionFocus || null,
      sessionFocusState: m.meta?.sessionFocusState || null,
      contextInsight: m.meta?.contextInsight || "",
      personalization: m.meta?.personalization || null,
      assistantMode:
        m.meta?.assistantMode ||
        m.meta?.personalization?.assistantMode ||
        "balanced",
      verificationMode:
        m.meta?.verificationMode ||
        m.meta?.trustMeta?.verificationMode ||
        m.meta?.personalization?.verificationMode ||
        "balanced",
      trustMeta: m.meta?.trustMeta || null,
      surface: m.meta?.surface || "web",
      feedback: m.meta?.feedback || null,
      rawThinking: m.meta?.rawThinking || "",
      reasoningAvailable: Boolean(
        m.meta?.reasoningAvailable || m.meta?.rawThinking,
      ),
      model: m.meta?.model || null,
      mode: m.meta?.mode || "chat",
      toolSummary: m.meta?.toolSummary || [],
    }),
    [],
  );

  const currentPageSnapshot = useMemo(
    () => buildChatContextPayload(registeredPageSnapshot),
    [registeredPageSnapshot],
  );
  const feedbackEnabled = Boolean(userInfo?._id);
  const showPageContextPreview = false;
  const modeMenuOpen = Boolean(modeMenuAnchorEl);

  // Instant jump (no animation) — used for initial history load
  const scheduleScrollToBottom = useCallback((behavior = "smooth") => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = messagesContainerRef.current;
        if (!el) return;
        if (behavior === "smooth" && typeof el.scrollTo === "function") {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
          return;
        }
        el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  const jumpToBottom = useCallback(() => {
    scheduleScrollToBottom("auto");
  }, [scheduleScrollToBottom]);

  // Smooth scroll — used when user sends/receives new messages
  const scrollToBottom = useCallback(() => {
    scheduleScrollToBottom("smooth");
  }, [scheduleScrollToBottom]);

  const isPrependingRef = useRef(false);

  // ─── Load older messages (cursor pagination) ───
  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMoreRef.current || !userInfo) return;
    isPrependingRef.current = true;
    setIsLoadingMore(true);
    try {
      const params = {};
      if (nextCursorRef.current) params.before = nextCursorRef.current;
      const res = await fetchHistory(params).unwrap();
      if (res?.messages?.length) {
        const mapped = res.messages
          .filter(
            (m) =>
              m.role === "user" || m.role === "assistant" || m.role === "bot",
          )
          .map(mapMessage);
        if (mapped.length) {
          const container = messagesContainerRef.current;
          const prevScrollHeight = container?.scrollHeight || 0;
          const prevScrollTop = container?.scrollTop || 0;
          setMessages((prev) => [...mapped, ...prev]);
          // Double-rAF: first waits for React commit, second for browser paint
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (container) {
                container.scrollTop =
                  prevScrollTop + (container.scrollHeight - prevScrollHeight);
              }
              isPrependingRef.current = false;
            });
          });
        } else {
          isPrependingRef.current = false;
        }
      } else {
        isPrependingRef.current = false;
      }
      nextCursorRef.current = res?.nextCursor || null;
      hasMoreRef.current = !!res?.hasMore;
    } catch {
      isPrependingRef.current = false;
    }
    setIsLoadingMore(false);
  }, [isLoadingMore, userInfo, fetchHistory, mapMessage]);

  const handleChatNavigate = useCallback(
    (path) => {
      setOpen(false);
      routerNavigate(path);
    },
    [routerNavigate],
  );

  const handleCloseDrawer = useCallback(() => setOpen(false), []);

  const logChatClientEvent = useCallback(
    async ({ messageId, type, label = "", actionType = "", success = true, detail = "" }) => {
      if (!messageId || !type) return;
      try {
        await sendChatTelemetryEvent({
          messageId,
          type,
          label,
          actionType,
          success,
          detail,
          surface: "web",
        }).unwrap();
      } catch {
        // silent telemetry failure
      }
    },
    [sendChatTelemetryEvent],
  );

  const handleComposerModeChange = useCallback((mode) => {
    setReasoningMode(mode === "force_reasoner" ? "force_reasoner" : "auto");
  }, []);

  const handleComposerAssistantModeChange = useCallback((mode) => {
    setAssistantMode(normalizeAssistantModeValue(mode));
  }, []);

  const handleComposerVerificationModeChange = useCallback((mode) => {
    setVerificationMode(normalizeVerificationModeValue(mode));
  }, []);

  const executeChatAction = useCallback(
    async (action, msg) => {
      const actionResult = await runChatAction(action, {
        navigate: routerNavigate,
        onClose: handleCloseDrawer,
        t,
        getActionHandler,
      });
      await logChatClientEvent({
        messageId: msg?.id || action?.messageId,
        type:
          actionResult?.status === "degraded"
            ? "action_degraded"
            : "action_executed",
        label: getChatActionLabel(action, t),
        actionType: action?.type || "",
        success: true,
        detail: actionResult?.detail || "",
      });
    },
    [routerNavigate, handleCloseDrawer, t, getActionHandler, logChatClientEvent],
  );

  const applyLocalMutationFallback = useCallback(async (mutationPreview) => {
    if (!mutationPreview?.type) return;

    if (mutationPreview.type === "save_bot_preference") {
      const nextMode =
        mutationPreview?.payload?.reasoningMode === "force_reasoner"
          ? "force_reasoner"
          : "auto";
      const nextAssistantMode = normalizeAssistantModeValue(
        mutationPreview?.payload?.assistantMode,
      );
      const nextVerificationMode = normalizeVerificationModeValue(
        mutationPreview?.payload?.verificationMode,
      );
      setReasoningMode(nextMode);
      setAssistantMode(nextAssistantMode);
      setVerificationMode(nextVerificationMode);
      return;
    }

    if (mutationPreview.type === "save_ui_preference") {
      const key = String(
        mutationPreview?.payload?.scopeKey || "page_default",
      ).trim();
      const current = JSON.parse(
        localStorage.getItem(CHATBOT_UI_PREFS_STORAGE_KEY) || "{}",
      );
      current[key] = {
        ...mutationPreview.payload,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(
        CHATBOT_UI_PREFS_STORAGE_KEY,
        JSON.stringify(current),
      );
      return;
    }

    if (mutationPreview.type === "stage_form_draft") {
      const key = String(
        mutationPreview?.payload?.draftKey || "form_draft",
      ).trim();
      const current = JSON.parse(
        localStorage.getItem(CHATBOT_FORM_DRAFTS_STORAGE_KEY) || "{}",
      );
      current[key] = {
        ...mutationPreview.payload,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(
        CHATBOT_FORM_DRAFTS_STORAGE_KEY,
        JSON.stringify(current),
      );
    }
  }, []);

  const executeWorkflow = useCallback(
    async (workflow, msg) => {
      const steps = Array.isArray(workflow?.steps) ? workflow.steps : [];
      if (!steps.length) return;

      let finalStatus = "workflow_executed";
      for (const step of steps) {
        try {
          const actionResult = await runChatAction(step.action, {
            navigate: routerNavigate,
            onClose: handleCloseDrawer,
            t,
            getActionHandler,
          });
          if (actionResult?.status === "degraded") {
            finalStatus = "workflow_degraded";
          }
          if (["navigate", "open_new_tab"].includes(step.action?.type)) {
            break;
          }
        } catch (error) {
          finalStatus = "workflow_unsupported";
          await logChatClientEvent({
            messageId: msg?.id,
            type: "workflow_unsupported",
            label: workflow?.title || "workflow",
            actionType: step?.action?.type || "",
            success: false,
            detail: error?.message || t("chatbot.actions.unsupported"),
          });
          throw error;
        }
      }

      await logChatClientEvent({
        messageId: msg?.id,
        type: finalStatus,
        label: workflow?.title || "workflow",
        actionType: "workflow",
        success: finalStatus !== "workflow_unsupported",
        detail: workflow?.runLabel || "",
      });
    },
    [
      getActionHandler,
      handleCloseDrawer,
      logChatClientEvent,
      routerNavigate,
      t,
    ],
  );

  const commitLightMutation = useCallback(
    async (mutationPreview, msg) => {
      const response = await commitChatMutation({
        mutationPreview,
        surface: "web",
      }).unwrap();

      await applyLocalMutationFallback(response?.mutation || mutationPreview);

      await logChatClientEvent({
        messageId: msg?.id,
        type: "mutation_confirmed",
        label: mutationPreview?.title || mutationPreview?.type || "mutation",
        actionType: mutationPreview?.type || "",
        success: true,
        detail: response?.localOnly ? "local_only" : "server_committed",
      });
    },
    [applyLocalMutationFallback, commitChatMutation, logChatClientEvent],
  );

  const handleChatAction = useCallback(
    async (action, msg) => {
      if (action?.requiresConfirm) {
        setPendingActionConfirm({ action, msg });
        return;
      }
      try {
        await executeChatAction(action, msg);
      } catch (error) {
        await logChatClientEvent({
          messageId: msg?.id || action?.messageId,
          type: "action_unsupported",
          label: getChatActionLabel(action, t),
          actionType: action?.type || "",
          success: false,
          detail: error?.message || t("chatbot.actions.unsupported"),
        });
      }
    },
    [executeChatAction, logChatClientEvent, t],
  );

  const handleWorkflowRun = useCallback(
    async (workflow, msg) => {
      if (!workflow?.steps?.length) return;
      if (workflow?.requiresConfirm) {
        setPendingWorkflowConfirm({ workflow, msg });
        return;
      }
      try {
        await executeWorkflow(workflow, msg);
      } catch {
        // already logged
      }
    },
    [executeWorkflow],
  );

  const handleMutationPreview = useCallback(
    async (mutationPreview, msg) => {
      if (!mutationPreview?.type) return;
      if (mutationPreview?.requiresConfirm !== false) {
        setPendingMutationConfirm({ mutationPreview, msg });
        return;
      }
      try {
        await commitLightMutation(mutationPreview, msg);
      } catch (error) {
        await logChatClientEvent({
          messageId: msg?.id,
          type: "mutation_cancelled",
          label: mutationPreview?.title || mutationPreview?.type || "mutation",
          actionType: mutationPreview?.type || "",
          success: false,
          detail: error?.message || "mutation_failed",
        });
      }
    },
    [commitLightMutation, logChatClientEvent],
  );

  const handlePinSessionFocus = useCallback(
    async (sessionFocus, msg) => {
      const normalized = normalizeSessionFocusOverrideValue({
        mode: "pin",
        sessionFocus,
      });
      if (normalized.mode !== "pin" || !normalized.sessionFocus) return;
      setSessionFocusOverride(normalized);
      await logChatClientEvent({
        messageId: msg?.id,
        type: "action_executed",
        label: "Ghim ngữ cảnh hội thoại",
        actionType: "session_focus_pin",
        success: true,
        detail:
          getActiveSessionFocusEntity(normalized.sessionFocus)?.label || "",
      });
    },
    [logChatClientEvent],
  );

  const handleDisableSessionFocus = useCallback(
    async (msg) => {
      setSessionFocusOverride({ mode: "off", sessionFocus: null });
      await logChatClientEvent({
        messageId: msg?.id,
        type: "action_executed",
        label: "Tắt ngữ cảnh hội thoại",
        actionType: "session_focus_off",
        success: true,
        detail: "off",
      });
    },
    [logChatClientEvent],
  );

  const handleResetSessionFocusOverride = useCallback(
    async (msg) => {
      setSessionFocusOverride({ mode: "auto", sessionFocus: null });
      await logChatClientEvent({
        messageId: msg?.id,
        type: "action_executed",
        label: "Trả về ngữ cảnh tự động",
        actionType: "session_focus_auto",
        success: true,
        detail: "auto",
      });
    },
    [logChatClientEvent],
  );

  const handleFeedback = useCallback(
    async (msg, value) => {
      if (!msg?.id) return;
      if (value === "negative") {
        setFeedbackReason("");
        setFeedbackNote("");
        setFeedbackDialog({ messageId: msg.id });
        return;
      }

      setFeedbackSubmittingId(msg.id);
      try {
        const response = await sendChatFeedback({
          messageId: msg.id,
          value,
        }).unwrap();
        setMessages((prev) =>
          prev.map((item) =>
            item.id === msg.id
              ? { ...item, feedback: response.feedback || { value } }
              : item,
          ),
        );
      } catch {
        // silent
      } finally {
        setFeedbackSubmittingId("");
      }
    },
    [sendChatFeedback],
  );

  const handleSubmitNegativeFeedback = useCallback(async () => {
    if (!feedbackDialog?.messageId) return;
    setFeedbackSubmittingId(feedbackDialog.messageId);
    try {
      const response = await sendChatFeedback({
        messageId: feedbackDialog.messageId,
        value: "negative",
        reason: feedbackReason,
        note: feedbackNote,
      }).unwrap();
      setMessages((prev) =>
        prev.map((item) =>
          item.id === feedbackDialog.messageId
            ? { ...item, feedback: response.feedback || { value: "negative", reason: feedbackReason, note: feedbackNote } }
            : item,
        ),
      );
      setFeedbackDialog(null);
      setFeedbackReason("");
      setFeedbackNote("");
    } catch {
      // silent
    } finally {
      setFeedbackSubmittingId("");
    }
  }, [feedbackDialog, feedbackNote, feedbackReason, sendChatFeedback]);

  const isNearBottomRef = useRef(true);
  const userJustSentRef = useRef(false);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    // Show/hide scroll-to-bottom button
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distanceFromBottom > 120);
    isNearBottomRef.current = distanceFromBottom < 150;
    // Infinite scroll: load more when near top
    if (
      el.scrollTop < 60 &&
      hasMoreRef.current &&
      !isLoadingMore &&
      !isPrependingRef.current
    ) {
      loadMore();
    }
  }, [isLoadingMore, loadMore]);

  // Auto-scroll to bottom ONLY when user is near bottom or just sent a message
  useEffect(() => {
    if (isPrependingRef.current) return;
    if (isNearBottomRef.current || userJustSentRef.current) {
      scrollToBottom();
      userJustSentRef.current = false;
    }
  }, [
    isTyping,
    liveSteps,
    liveDraft?.text,
    liveDraft?.rawThinking,
    messages.length,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (open) {
      // Scroll to bottom when drawer (re)opens — delay for Drawer animation
      setTimeout(() => jumpToBottom(), 350);
    }
  }, [open, jumpToBottom]);

  // Load initial history on first open
  useEffect(() => {
    if (!open || historyLoaded.current || !userInfo) return;
    historyLoaded.current = true;
    isPrependingRef.current = true; // Prevent smooth scroll for initial load
    (async () => {
      try {
        const res = await fetchHistory({}).unwrap();
        if (res?.messages?.length) {
          const mapped = res.messages
            .filter(
              (m) =>
                m.role === "user" || m.role === "assistant" || m.role === "bot",
            )
            .map(mapMessage);
          if (mapped.length) setMessages(mapped);

          // Restore suggestions from the last bot message
          const lastBotMsg = [...res.messages]
            .reverse()
            .find((m) => m.role === "bot");
          if (lastBotMsg?.meta?.suggestions?.length) {
            setDynamicSuggestions(lastBotMsg.meta.suggestions);
          }
        }
        nextCursorRef.current = res?.nextCursor || null;
        hasMoreRef.current = !!res?.hasMore;
      } catch {
        /* ignore - guest users */
      }
      // Instant jump to bottom after history loads (no animation)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          jumpToBottom();
          isPrependingRef.current = false;
        });
      });
    })();
  }, [open, userInfo, fetchHistory, mapMessage, jumpToBottom]);

  // Reset chat state when user changes (logout/login)
  const prevUserIdRef = useRef(userInfo?._id);
  useEffect(() => {
    const currentId = userInfo?._id || null;
    const prevId = prevUserIdRef.current || null;
    if (currentId !== prevId) {
      prevUserIdRef.current = currentId;
      setMessages([]);
      setDynamicSuggestions([]);
      setLiveDraft(null);
      setLiveSteps([]);
      setShowSettings(false);
      historyLoaded.current = false;
      nextCursorRef.current = null;
      hasMoreRef.current = true;
    }
  }, [userInfo?._id]);

  // ─── Send message via SSE stream ───
  const startSend = useCallback(async (text, options = {}) => {
    const nextText = String(text ?? "").trim();
    const requestReasoningMode =
      options?.reasoningMode === "force_reasoner" ? "force_reasoner" : "auto";
    const requestAssistantMode = normalizeAssistantModeValue(
      options?.assistantMode || composerAssistantModeRef.current,
    );
    const requestVerificationMode = normalizeVerificationModeValue(
      options?.verificationMode || composerVerificationModeRef.current,
    );
    if (!nextText || isTyping) return;
    userJustSentRef.current = true;
    isNearBottomRef.current = true;
    setMessages((prev) => [...prev, { role: "user", text: nextText }]);
    setIsTyping(true);
    setDynamicSuggestions([]);
    setReasonerMessage(null);

    liveStepsRef.current = [];
    liveReplyRef.current = "";
    liveReasoningRef.current = "";
    liveMetaRef.current = {
      model: null,
      mode: "chat",
      navigation: null,
      actions: [],
      answerCards: [],
      sources: [],
      contextInsight: "",
      personalization: null,
      trustMeta: null,
      reasoningAvailable: false,
      intent: "",
      routeKind: "",
      routeLane: "",
      queryScope: "",
      contextConfidence: "",
      capabilityKeys: [],
      actionExecutionSummary: null,
      workflow: null,
      mutationPreview: null,
      sessionFocus: null,
      sessionFocusState: null,
      assistantMode: requestAssistantMode,
      verificationMode: requestVerificationMode,
      surface: "web",
      messageId: null,
      firstTokenLatencyMs: null,
      processingTime: null,
      processingTimeMs: null,
    };
    setLiveSteps([]);
    setLiveDraft({
      role: "bot",
      text: "",
      rawThinking: "",
      reasoningAvailable: false,
      thinkingSteps: [],
      isStreaming: true,
      mode: "chat",
      actions: [],
      answerCards: [],
      sources: [],
      contextInsight: "",
      personalization: null,
      trustMeta: null,
      intent: "",
      routeKind: "",
      routeLane: "",
      queryScope: "",
      contextConfidence: "",
      capabilityKeys: [],
      actionExecutionSummary: null,
      workflow: null,
      mutationPreview: null,
      sessionFocus: null,
      sessionFocusState: null,
      assistantMode: requestAssistantMode,
      verificationMode: requestVerificationMode,
      surface: "web",
      messageId: null,
    });
    const requestPageSnapshot = buildChatContextPayload(registeredPageSnapshot);

    abortControllerRef.current = new AbortController();
    let replyData = null;
    let streamAborted = false;

    const commitLiveDraft = () => {
      setLiveDraft({
        role: "bot",
        id: liveMetaRef.current.messageId || undefined,
        text: liveReplyRef.current,
        rawThinking: liveReasoningRef.current,
        reasoningAvailable:
          Boolean(liveReasoningRef.current) ||
          Boolean(liveMetaRef.current.reasoningAvailable),
        thinkingSteps: [...liveStepsRef.current],
        isStreaming: true,
        model: liveMetaRef.current.model,
        mode: liveMetaRef.current.mode,
        navigation: liveMetaRef.current.navigation,
        actions: liveMetaRef.current.actions,
        answerCards: liveMetaRef.current.answerCards,
        sources: liveMetaRef.current.sources,
        intent: liveMetaRef.current.intent,
        routeKind: liveMetaRef.current.routeKind,
        routeLane: liveMetaRef.current.routeLane,
        queryScope: liveMetaRef.current.queryScope,
        contextConfidence: liveMetaRef.current.contextConfidence,
        capabilityKeys: liveMetaRef.current.capabilityKeys,
        actionExecutionSummary: liveMetaRef.current.actionExecutionSummary,
        workflow: liveMetaRef.current.workflow,
        mutationPreview: liveMetaRef.current.mutationPreview,
        sessionFocus: liveMetaRef.current.sessionFocus,
        sessionFocusState: liveMetaRef.current.sessionFocusState,
        contextInsight: liveMetaRef.current.contextInsight,
        personalization: liveMetaRef.current.personalization,
        assistantMode: liveMetaRef.current.assistantMode,
        verificationMode: liveMetaRef.current.verificationMode,
        trustMeta: liveMetaRef.current.trustMeta,
        surface: liveMetaRef.current.surface,
      });
    };

    const syncLiveDraft = () => {
      if (draftFrameRef.current) return;
      draftFrameRef.current = requestAnimationFrame(() => {
        draftFrameRef.current = null;
        commitLiveDraft();
      });
    };

    const replaceSteps = (nextSteps) => {
      liveStepsRef.current = nextSteps;
      setLiveSteps([...nextSteps]);
      syncLiveDraft();
    };

    try {
      await sendMessageStream(
        nextText,
        requestPageSnapshot,
        capabilityKeys,
        requestReasoningMode,
        requestAssistantMode,
        requestVerificationMode,
        "auto",
        getOrCreateChatCohortId(),
        sessionFocusOverrideRef.current,
        (event, data) => {
          switch (event) {
            case "thinking": {
              const nextSteps = liveStepsRef.current.map((step) =>
                step.status === "running" ? { ...step, status: "done" } : step,
              );
              nextSteps.push({
                label: data.step,
                status: "running",
              });
              replaceSteps(nextSteps);
              break;
            }
            case "tool_start": {
              const nextSteps = liveStepsRef.current.map((step) =>
                step.status === "running" ? { ...step, status: "done" } : step,
              );
              nextSteps.push({
                label: `${data.label || data.tool}...`,
                status: "running",
                tool: data.tool,
              });
              replaceSteps(nextSteps);
              break;
            }
            case "tool_done": {
              const nextSteps = [...liveStepsRef.current];
              const idx = nextSteps.findLastIndex(
                (step) => step.tool === data.tool && step.status === "running",
              );
              if (idx !== -1) {
                nextSteps[idx] = {
                  ...nextSteps[idx],
                  label: data.resultPreview || data.label || data.tool,
                  status: "done",
                  durationMs: data.durationMs,
                  error: data.error || false,
                };
              }
              replaceSteps(nextSteps);
              break;
            }
            case "message_start": {
              liveMetaRef.current = {
                ...liveMetaRef.current,
                model: data.model || liveMetaRef.current.model,
                mode: data.mode || liveMetaRef.current.mode,
                actions: data.actions || liveMetaRef.current.actions,
                answerCards: data.answerCards || liveMetaRef.current.answerCards,
                sources: data.sources || liveMetaRef.current.sources,
                intent: data.intent || liveMetaRef.current.intent,
                routeKind: data.routeKind || liveMetaRef.current.routeKind,
                routeLane: data.routeLane || liveMetaRef.current.routeLane,
                queryScope: data.queryScope || liveMetaRef.current.queryScope,
                contextConfidence:
                  data.contextConfidence ||
                  liveMetaRef.current.contextConfidence,
                capabilityKeys:
                  data.capabilityKeys || liveMetaRef.current.capabilityKeys,
                actionExecutionSummary:
                  data.actionExecutionSummary ||
                  liveMetaRef.current.actionExecutionSummary,
                workflow: data.workflow || liveMetaRef.current.workflow,
                mutationPreview:
                  data.mutationPreview || liveMetaRef.current.mutationPreview,
                sessionFocus:
                  data.sessionFocus || liveMetaRef.current.sessionFocus,
                sessionFocusState:
                  data.sessionFocusState || liveMetaRef.current.sessionFocusState,
                contextInsight:
                  data.contextInsight || liveMetaRef.current.contextInsight,
                personalization:
                  data.personalization || liveMetaRef.current.personalization,
                assistantMode:
                  data.assistantMode ||
                  data.personalization?.assistantMode ||
                  liveMetaRef.current.assistantMode,
                verificationMode:
                  data.verificationMode ||
                  data.trustMeta?.verificationMode ||
                  data.personalization?.verificationMode ||
                  liveMetaRef.current.verificationMode,
                trustMeta: data.trustMeta || liveMetaRef.current.trustMeta,
                surface: data.surface || liveMetaRef.current.surface,
              };
              syncLiveDraft();
              break;
            }
            case "reasoning_start": {
              liveMetaRef.current = {
                ...liveMetaRef.current,
                reasoningAvailable: true,
                mode: data?.mode || "reasoner",
              };
              syncLiveDraft();
              break;
            }
            case "reasoning_delta": {
              liveReasoningRef.current += data.delta || "";
              liveMetaRef.current = {
                ...liveMetaRef.current,
                reasoningAvailable: true,
              };
              syncLiveDraft();
              break;
            }
            case "message_delta": {
              liveReplyRef.current += data.delta || "";
              syncLiveDraft();
              break;
            }
            case "message_done": {
              liveStepsRef.current = liveStepsRef.current.map((step) =>
                step.status === "running" ? { ...step, status: "done" } : step,
              );
              setLiveSteps([...liveStepsRef.current]);
              liveMetaRef.current = {
                ...liveMetaRef.current,
                model: data.model || liveMetaRef.current.model,
                mode: data.mode || liveMetaRef.current.mode,
                navigation: data.navigation || null,
                actions: data.actions || liveMetaRef.current.actions,
                answerCards: data.answerCards || liveMetaRef.current.answerCards,
                sources: data.sources || liveMetaRef.current.sources,
                intent: data.intent || liveMetaRef.current.intent,
                routeKind: data.routeKind || liveMetaRef.current.routeKind,
                routeLane: data.routeLane || liveMetaRef.current.routeLane,
                queryScope: data.queryScope || liveMetaRef.current.queryScope,
                contextConfidence:
                  data.contextConfidence ||
                  liveMetaRef.current.contextConfidence,
                capabilityKeys:
                  data.capabilityKeys || liveMetaRef.current.capabilityKeys,
                actionExecutionSummary:
                  data.actionExecutionSummary ||
                  liveMetaRef.current.actionExecutionSummary,
                workflow: data.workflow || liveMetaRef.current.workflow,
                mutationPreview:
                  data.mutationPreview || liveMetaRef.current.mutationPreview,
                sessionFocus:
                  data.sessionFocus || liveMetaRef.current.sessionFocus,
                sessionFocusState:
                  data.sessionFocusState || liveMetaRef.current.sessionFocusState,
                contextInsight:
                  data.contextInsight || liveMetaRef.current.contextInsight,
                personalization:
                  data.personalization || liveMetaRef.current.personalization,
                verificationMode:
                  data.verificationMode ||
                  data.trustMeta?.verificationMode ||
                  data.personalization?.verificationMode ||
                  liveMetaRef.current.verificationMode,
                trustMeta: data.trustMeta || liveMetaRef.current.trustMeta,
                surface: data.surface || liveMetaRef.current.surface,
                reasoningAvailable: Boolean(
                  data.reasoningAvailable ||
                    liveReasoningRef.current ||
                    liveMetaRef.current.reasoningAvailable,
                ),
                firstTokenLatencyMs:
                  data.firstTokenLatencyMs || liveMetaRef.current.firstTokenLatencyMs,
                processingTime:
                  data.processingTimeMs || liveMetaRef.current.processingTime,
                processingTimeMs:
                  data.processingTimeMs || liveMetaRef.current.processingTimeMs,
              };
              replyData = {
                text: data.text || liveReplyRef.current,
                toolsUsed: data.toolsUsed || [],
                processingTime:
                  data.processingTimeMs || liveMetaRef.current.processingTimeMs,
                model: liveMetaRef.current.model,
                mode: liveMetaRef.current.mode,
                navigation: liveMetaRef.current.navigation,
                actions: liveMetaRef.current.actions,
                answerCards: liveMetaRef.current.answerCards,
                sources: liveMetaRef.current.sources,
                intent: liveMetaRef.current.intent,
                routeKind: liveMetaRef.current.routeKind,
                routeLane: liveMetaRef.current.routeLane,
                queryScope: liveMetaRef.current.queryScope,
                contextConfidence: liveMetaRef.current.contextConfidence,
                capabilityKeys: liveMetaRef.current.capabilityKeys,
                actionExecutionSummary:
                  liveMetaRef.current.actionExecutionSummary,
                workflow: liveMetaRef.current.workflow,
                mutationPreview: liveMetaRef.current.mutationPreview,
                sessionFocus: liveMetaRef.current.sessionFocus,
                sessionFocusState: liveMetaRef.current.sessionFocusState,
                contextInsight: liveMetaRef.current.contextInsight,
                personalization: liveMetaRef.current.personalization,
                assistantMode: liveMetaRef.current.assistantMode,
                verificationMode: liveMetaRef.current.verificationMode,
                trustMeta: liveMetaRef.current.trustMeta,
                surface: liveMetaRef.current.surface,
                rawThinking: liveReasoningRef.current,
                reasoningAvailable: liveMetaRef.current.reasoningAvailable,
              };
              syncLiveDraft();
              break;
            }
            case "reply": {
              replyData = {
                ...replyData,
                text: data.text || liveReplyRef.current,
                toolsUsed: data.toolsUsed || [],
                processingTime:
                  data.processingTimeMs || data.processingTime || null,
                navigation: data.navigation || liveMetaRef.current.navigation,
                model: data.model || liveMetaRef.current.model,
                mode: data.mode || liveMetaRef.current.mode,
                actions: data.actions || liveMetaRef.current.actions,
                answerCards: data.answerCards || liveMetaRef.current.answerCards,
                sources: data.sources || liveMetaRef.current.sources,
                intent: data.intent || liveMetaRef.current.intent,
                routeKind: data.routeKind || liveMetaRef.current.routeKind,
                routeLane: data.routeLane || liveMetaRef.current.routeLane,
                queryScope: data.queryScope || liveMetaRef.current.queryScope,
                contextConfidence:
                  data.contextConfidence ||
                  liveMetaRef.current.contextConfidence,
                capabilityKeys:
                  data.capabilityKeys || liveMetaRef.current.capabilityKeys,
                actionExecutionSummary:
                  data.actionExecutionSummary ||
                  liveMetaRef.current.actionExecutionSummary,
                workflow: data.workflow || liveMetaRef.current.workflow,
                mutationPreview:
                  data.mutationPreview || liveMetaRef.current.mutationPreview,
                sessionFocus:
                  data.sessionFocus || liveMetaRef.current.sessionFocus,
                sessionFocusState:
                  data.sessionFocusState || liveMetaRef.current.sessionFocusState,
                contextInsight:
                  data.contextInsight || liveMetaRef.current.contextInsight,
                personalization:
                  data.personalization || liveMetaRef.current.personalization,
                assistantMode:
                  data.assistantMode ||
                  data.personalization?.assistantMode ||
                  liveMetaRef.current.assistantMode,
                verificationMode:
                  data.verificationMode ||
                  data.trustMeta?.verificationMode ||
                  data.personalization?.verificationMode ||
                  liveMetaRef.current.verificationMode,
                trustMeta: data.trustMeta || liveMetaRef.current.trustMeta,
                surface: data.surface || liveMetaRef.current.surface,
                rawThinking: liveReasoningRef.current,
                reasoningAvailable: Boolean(
                  data.reasoningAvailable || liveReasoningRef.current,
                ),
              };
              break;
            }
            case "persisted": {
              liveMetaRef.current = {
                ...liveMetaRef.current,
                messageId: data.messageId || liveMetaRef.current.messageId,
              };
              syncLiveDraft();
              break;
            }
            case "error": {
              liveStepsRef.current = liveStepsRef.current.map((step) =>
                step.status === "running"
                  ? { ...step, status: "done", error: true }
                  : step,
              );
              setLiveSteps([...liveStepsRef.current]);
              replyData = {
                text: `❌ ${data.message || t("chatbot.errors.generic")}`,
                toolsUsed: [],
                processingTime: null,
                navigation: null,
                actions: [],
                answerCards: [],
                sources: [],
                contextInsight: "",
                personalization: null,
                trustMeta: null,
                intent: "",
                routeKind: "",
                routeLane: "",
                queryScope: "",
                contextConfidence: "",
                capabilityKeys: [],
                actionExecutionSummary: null,
                workflow: null,
                mutationPreview: null,
                sessionFocus: liveMetaRef.current.sessionFocus,
                sessionFocusState: liveMetaRef.current.sessionFocusState,
                surface: liveMetaRef.current.surface,
                model: liveMetaRef.current.model,
                mode: liveMetaRef.current.mode,
                rawThinking: liveReasoningRef.current,
                reasoningAvailable: Boolean(liveReasoningRef.current),
              };
              syncLiveDraft();
              break;
            }
            case "suggestions": {
              if (Array.isArray(data.suggestions)) {
                setDynamicSuggestions(data.suggestions);
              }
              break;
            }
            case "done":
            default:
              break;
          }
        },
        abortControllerRef.current.signal,
      );

      if (replyData || liveReplyRef.current) {
        if (draftFrameRef.current) {
          cancelAnimationFrame(draftFrameRef.current);
          draftFrameRef.current = null;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: liveMetaRef.current.messageId || undefined,
            role: "bot",
            text: replyData?.text || liveReplyRef.current,
            toolsUsed: replyData?.toolsUsed || [],
            processingTime:
              replyData?.processingTime || liveMetaRef.current.processingTimeMs,
            thinkingSteps: [...liveStepsRef.current],
            navigation: replyData?.navigation || liveMetaRef.current.navigation,
            actions: replyData?.actions || liveMetaRef.current.actions,
            answerCards:
              replyData?.answerCards || liveMetaRef.current.answerCards,
            sources: replyData?.sources || liveMetaRef.current.sources,
            intent: replyData?.intent || liveMetaRef.current.intent,
            routeKind:
              replyData?.routeKind || liveMetaRef.current.routeKind,
            routeLane:
              replyData?.routeLane || liveMetaRef.current.routeLane,
            queryScope:
              replyData?.queryScope || liveMetaRef.current.queryScope,
            contextConfidence:
              replyData?.contextConfidence ||
              liveMetaRef.current.contextConfidence,
            capabilityKeys:
              replyData?.capabilityKeys || liveMetaRef.current.capabilityKeys,
            actionExecutionSummary:
              replyData?.actionExecutionSummary ||
              liveMetaRef.current.actionExecutionSummary,
            workflow: replyData?.workflow || liveMetaRef.current.workflow,
            mutationPreview:
              replyData?.mutationPreview ||
              liveMetaRef.current.mutationPreview,
            sessionFocus:
              replyData?.sessionFocus || liveMetaRef.current.sessionFocus,
            sessionFocusState:
              replyData?.sessionFocusState || liveMetaRef.current.sessionFocusState,
            contextInsight:
              replyData?.contextInsight || liveMetaRef.current.contextInsight,
            personalization:
              replyData?.personalization || liveMetaRef.current.personalization,
            assistantMode:
              replyData?.assistantMode || liveMetaRef.current.assistantMode,
            verificationMode:
              replyData?.verificationMode ||
              liveMetaRef.current.verificationMode,
            trustMeta: replyData?.trustMeta || liveMetaRef.current.trustMeta,
            surface: replyData?.surface || liveMetaRef.current.surface,
            rawThinking: replyData?.rawThinking || liveReasoningRef.current,
            reasoningAvailable: Boolean(
              replyData?.reasoningAvailable || liveReasoningRef.current,
            ),
            model: replyData?.model || liveMetaRef.current.model,
            mode: replyData?.mode || liveMetaRef.current.mode,
            feedback: null,
          },
        ]);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        streamAborted = true;
        if (draftFrameRef.current) {
          cancelAnimationFrame(draftFrameRef.current);
          draftFrameRef.current = null;
        }
        if (liveReplyRef.current || liveReasoningRef.current) {
          setMessages((prev) => [
            ...prev,
            {
              id: liveMetaRef.current.messageId || undefined,
              role: "bot",
              text: liveReplyRef.current,
              toolsUsed: [],
              processingTime: liveMetaRef.current.processingTimeMs,
              thinkingSteps: [...liveStepsRef.current],
              navigation: liveMetaRef.current.navigation,
              actions: liveMetaRef.current.actions,
              answerCards: liveMetaRef.current.answerCards,
              sources: liveMetaRef.current.sources,
              intent: liveMetaRef.current.intent,
              routeKind: liveMetaRef.current.routeKind,
              routeLane: liveMetaRef.current.routeLane,
              queryScope: liveMetaRef.current.queryScope,
              contextConfidence: liveMetaRef.current.contextConfidence,
              capabilityKeys: liveMetaRef.current.capabilityKeys,
              actionExecutionSummary:
                liveMetaRef.current.actionExecutionSummary,
              workflow: liveMetaRef.current.workflow,
              mutationPreview: liveMetaRef.current.mutationPreview,
              sessionFocus: liveMetaRef.current.sessionFocus,
              sessionFocusState: liveMetaRef.current.sessionFocusState,
              contextInsight: liveMetaRef.current.contextInsight,
              personalization: liveMetaRef.current.personalization,
              assistantMode: liveMetaRef.current.assistantMode,
              verificationMode: liveMetaRef.current.verificationMode,
              trustMeta: liveMetaRef.current.trustMeta,
              surface: liveMetaRef.current.surface,
              rawThinking: liveReasoningRef.current,
              reasoningAvailable: Boolean(liveReasoningRef.current),
              model: liveMetaRef.current.model,
              mode: liveMetaRef.current.mode,
              interrupted: true,
              feedback: null,
            },
          ]);
        }
        return;
      }

      let errorText = `❌ ${t("chatbot.errors.genericRetry")}`;
      if (
        err.message?.includes("session_limit_reached") ||
        err.message?.includes("429")
      ) {
        errorText = `⏳ ${t("chatbot.errors.rateLimit")}`;
      } else if (err.message) {
        errorText = `❌ ${err.message}`;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: errorText,
          thinkingSteps: [...liveStepsRef.current],
          actions: [],
          answerCards: [],
          sources: [],
          contextInsight: "",
          personalization: null,
          trustMeta: null,
          intent: "",
          routeKind: "",
          routeLane: "",
          queryScope: "",
          contextConfidence: "",
          capabilityKeys: [],
          actionExecutionSummary: null,
          workflow: null,
          mutationPreview: null,
          sessionFocus: null,
          surface: liveMetaRef.current.surface,
          verificationMode: liveMetaRef.current.verificationMode,
          rawThinking: liveReasoningRef.current,
          reasoningAvailable: Boolean(liveReasoningRef.current),
          model: liveMetaRef.current.model,
          mode: liveMetaRef.current.mode,
          feedback: null,
        },
      ]);
    } finally {
      if (draftFrameRef.current) {
        cancelAnimationFrame(draftFrameRef.current);
        draftFrameRef.current = null;
      }
      abortControllerRef.current = null;
      setIsTyping(false);
      setLiveDraft(null);
      if (!streamAborted) {
        setLiveSteps([]);
      } else {
        liveStepsRef.current = [];
        setLiveSteps([]);
      }
    }
  }, [capabilityKeys, isTyping, registeredPageSnapshot, t]);

  const handleSend = useCallback(
    (
      text,
      reasoningModeOverride = composerReasoningModeRef.current,
      assistantModeOverride = composerAssistantModeRef.current,
      verificationModeOverride = composerVerificationModeRef.current,
    ) =>
      startSend(text, {
        reasoningMode: reasoningModeOverride,
        assistantMode: assistantModeOverride,
        verificationMode: verificationModeOverride,
      }),
    [startSend],
  );

  const handleQuickSend = useCallback(
    async (text, source = "") => {
      const lastBotMessage = [...messages]
        .reverse()
        .find((item) => item.role === "bot" && item.id);
      if (lastBotMessage?.id && source) {
        await logChatClientEvent({
          messageId: lastBotMessage.id,
          type: "suggestion_clicked",
          label: text,
          detail: source,
        });
      }
      void startSend(text, {
        reasoningMode: composerReasoningModeRef.current,
        assistantMode: composerAssistantModeRef.current,
        verificationMode: composerVerificationModeRef.current,
      });
    },
    [logChatClientEvent, messages, startSend],
  );

  const handleStopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleClear = useCallback(async () => {
    setConfirmClearOpen(false);
    setShowSettings(false);
    try {
      await clearHistory().unwrap();
    } catch {
      /* ignore */
    }
    setMessages([]);
    setDynamicSuggestions([]);
    historyLoaded.current = false;
    nextCursorRef.current = null;
    hasMoreRef.current = true;
  }, [clearHistory]);

  const drawerWidth = isMobile ? "100vw" : 420;
  const welcomeSuggestions = useMemo(
    () => getWelcomeSuggestions(userInfo, t),
    [userInfo, t],
  );

  const renderedWelcomeSuggestions = useMemo(
    () =>
      welcomeSuggestions.map((text) => (
        <Box
          key={text}
          onClick={() => void handleQuickSend(text, "welcome")}
          sx={{
            px: 1.5,
            py: 0.8,
            borderRadius: 2,
            fontSize: "0.8rem",
            cursor: "pointer",
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            color: theme.palette.primary.main,
            transition: "all 0.2s",
            "&:hover": {
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderColor: theme.palette.primary.main,
            },
          }}
        >
          {text}
        </Box>
      )),
    [handleQuickSend, theme, welcomeSuggestions],
  );

  const renderedDynamicSuggestions = useMemo(
    () =>
      dynamicSuggestions.map((text) => (
        <Box
          key={text}
          onClick={() => void handleQuickSend(text, "dynamic")}
          sx={{
            px: 1.2,
            py: 0.5,
            borderRadius: 2,
            fontSize: "0.75rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
            color: theme.palette.primary.main,
            transition: "all 0.2s",
            "&:hover": {
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderColor: theme.palette.primary.main,
            },
          }}
        >
          {text}
        </Box>
      )),
    [dynamicSuggestions, handleQuickSend, theme],
  );

  const renderedMessages = useMemo(
    () =>
      messages.map((msg, i) => (
        <MessageBubble
          key={msg.id || `msg-${i}`}
          msg={msg}
          theme={theme}
          onNavigate={handleChatNavigate}
          onAction={handleChatAction}
          onRunWorkflow={handleWorkflowRun}
          onCommitMutation={handleMutationPreview}
          sessionFocusOverride={sessionFocusOverride}
          onPinSessionFocus={handlePinSessionFocus}
          onDisableSessionFocus={handleDisableSessionFocus}
          onResetSessionFocusOverride={handleResetSessionFocusOverride}
          onClose={handleCloseDrawer}
          onOpenReasoner={setReasonerMessage}
          onFeedback={feedbackEnabled ? handleFeedback : undefined}
          feedbackSubmitting={feedbackSubmittingId === msg.id}
          t={t}
        />
      )),
    [
      feedbackEnabled,
      feedbackSubmittingId,
      handleChatAction,
      handleChatNavigate,
      handleCloseDrawer,
      handleFeedback,
      handleDisableSessionFocus,
      handleMutationPreview,
      handlePinSessionFocus,
      handleResetSessionFocusOverride,
      handleWorkflowRun,
      messages,
      sessionFocusOverride,
      theme,
      t,
    ],
  );

  const renderedLiveDraft = useMemo(() => {
    if (!liveDraft?.text) return null;
    return (
      <MessageBubble
        msg={liveDraft}
        theme={theme}
        onNavigate={handleChatNavigate}
        onAction={handleChatAction}
        onRunWorkflow={handleWorkflowRun}
        onCommitMutation={handleMutationPreview}
        sessionFocusOverride={sessionFocusOverride}
        onPinSessionFocus={handlePinSessionFocus}
        onDisableSessionFocus={handleDisableSessionFocus}
        onResetSessionFocusOverride={handleResetSessionFocusOverride}
        onClose={handleCloseDrawer}
        onOpenReasoner={setReasonerMessage}
        onFeedback={feedbackEnabled ? handleFeedback : undefined}
        feedbackSubmitting={feedbackSubmittingId === liveDraft.id}
        t={t}
      />
    );
  }, [
    feedbackEnabled,
    feedbackSubmittingId,
    handleChatAction,
    handleChatNavigate,
    handleCloseDrawer,
    handleFeedback,
    handleDisableSessionFocus,
    handleMutationPreview,
    handlePinSessionFocus,
    handleResetSessionFocusOverride,
    handleWorkflowRun,
    liveDraft,
    sessionFocusOverride,
    theme,
    t,
  ]);

  return (
    <>
      {/* ═══ FAB ═══ */}
      <Fade in={!open}>
        <Fab
          id="chatbot-fab"
          color="primary"
          onClick={() => setOpen(true)}
          sx={{
            position: "fixed",
            bottom: isMobile ? 80 : 24,
            right: 24,
            zIndex: 1200,
            width: 60,
            height: 60,
            boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.4)}`,
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
            transition: "all 0.3s ease",
            "&:hover": {
              transform: "scale(1.1)",
              boxShadow: `0 6px 28px ${alpha(theme.palette.primary.main, 0.5)}`,
            },
          }}
        >
          <Badge color="error" variant="dot" invisible={messages.length > 0}>
            <Box
              component="img"
              src={BOT_ICON}
              alt="Bot"
              sx={{ width: 34, height: 34, borderRadius: "50%" }}
            />
          </Badge>
        </Fab>
      </Fade>

      {/* ═══ Drawer ═══ */}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{
          sx: {
            width: drawerWidth,
            maxWidth: "100vw",
            display: "flex",
            flexDirection: "column",
            bgcolor: isDark ? "#0d1117" : "#f6f8fa",
          },
        }}
      >
        {/* ─── Header ─── */}
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
            color: "#fff",
            minHeight: 64,
          }}
        >
          {showSettings && (
            <IconButton
              size="small"
              onClick={() => setShowSettings(false)}
              sx={{
                color: "rgba(255,255,255,0.7)",
                "&:hover": { color: "#fff" },
                ml: -0.5,
              }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          )}
          <Avatar
            src={BOT_ICON}
            sx={{
              bgcolor: "rgba(255,255,255,0.2)",
              backdropFilter: "blur(8px)",
              width: 40,
              height: 40,
            }}
          />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {showSettings ? t("chatbot.settingsTitle") : t("chatbot.title")}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {showSettings
                ? t("chatbot.settingsSubtitle")
                : isTyping
                  ? t("chatbot.processing")
                  : t("chatbot.subtitle")}
            </Typography>
          </Box>
          {!showSettings && (
            <Tooltip title={t("chatbot.settingsTooltip")}>
              <IconButton
                size="small"
                onClick={() => setShowSettings(true)}
                sx={{
                  color: "rgba(255,255,255,0.7)",
                  "&:hover": { color: "#fff" },
                }}
              >
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t("chatbot.closeTooltip")}>
            <IconButton
              size="small"
              onClick={() => setOpen(false)}
              sx={{
                color: "rgba(255,255,255,0.7)",
                "&:hover": { color: "#fff" },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <Divider />

        {/* ─── Settings Panel ─── */}
        {showSettings ? (
          <Box
            sx={{
              flex: 1,
              overflowY: "auto",
              p: 2.5,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            <Typography
              variant="subtitle2"
              fontWeight={700}
              sx={{
                mb: 1,
                fontSize: "0.9rem",
                display: "flex",
                alignItems: "center",
                gap: 0.8,
              }}
            >
              <SettingsIcon sx={{ fontSize: 18, color: "text.secondary" }} />{" "}
              {t("chatbot.settingsTitle")}
            </Typography>

            {/* Memory info */}
            <Box
              sx={{
                borderRadius: 2,
                border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                bgcolor: alpha(
                  theme.palette.background.paper,
                  isDark ? 0.4 : 0.9,
                ),
                p: 2,
              }}
            >
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{
                  mb: 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.8,
                }}
              >
                <PsychologyIcon
                  sx={{ fontSize: 18, color: theme.palette.primary.main }}
                />{" "}
                {t("chatbot.settings.memoryTitle")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("chatbot.settings.sessionMessageCount", {
                  count: messages.length,
                })}
              </Typography>
              <Box sx={{ mt: 1.5 }}>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => setConfirmClearOpen(true)}
                  sx={{
                    textTransform: "none",
                    fontWeight: 600,
                    borderRadius: 2,
                    fontSize: "0.8rem",
                  }}
                >
                  {t("chatbot.settings.clearHistory")}
                </Button>
              </Box>
            </Box>

            {/* Bot info */}
            <Box
              sx={{
                borderRadius: 2,
                border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                bgcolor: alpha(
                  theme.palette.background.paper,
                  isDark ? 0.4 : 0.9,
                ),
                p: 2,
              }}
            >
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{
                  mb: 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.8,
                }}
              >
                <SmartToyIcon
                  sx={{ fontSize: 18, color: theme.palette.info.main }}
                />{" "}
                {t("chatbot.settings.botInfoTitle")}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                component="div"
                sx={{ lineHeight: 1.8 }}
              >
                <b>{t("chatbot.settings.botNameLabel")}:</b>{" "}
                {t("chatbot.settings.botNameValue")}
                <br />
                <b>{t("chatbot.settings.capabilitiesLabel")}:</b>{" "}
                {t("chatbot.settings.capabilitiesValue")}
                <br />
                <b>Phiên bản PickleTour:</b> {PICKLETOUR_VERSION}
              </Typography>
            </Box>

            {/* Tips */}
            <Box
              sx={{
                borderRadius: 2,
                border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                bgcolor: alpha(
                  theme.palette.background.paper,
                  isDark ? 0.4 : 0.9,
                ),
                p: 2,
              }}
            >
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{
                  mb: 0.5,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.8,
                }}
              >
                <TipsAndUpdatesIcon
                  sx={{ fontSize: 18, color: theme.palette.warning.main }}
                />{" "}
                {t("chatbot.settings.tipsTitle")}
              </Typography>
              <Box
                component="ul"
                sx={{ m: 0, pl: 2.25, color: "text.secondary" }}
              >
                {Array.isArray(tipItems) &&
                  tipItems.map((tip) => (
                    <Typography
                      key={tip}
                      component="li"
                      variant="caption"
                      sx={{ lineHeight: 1.8 }}
                    >
                      {tip}
                    </Typography>
                  ))}
              </Box>
            </Box>

            {/* Learning memory (admin only) */}
            {userInfo?.role === "admin" && (
              <Box
                sx={{
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
                  bgcolor: alpha(
                    theme.palette.background.paper,
                    isDark ? 0.4 : 0.9,
                  ),
                  p: 2,
                }}
              >
                <Typography
                  variant="body2"
                  fontWeight={600}
                  sx={{
                    mb: 0.5,
                    display: "flex",
                    alignItems: "center",
                    gap: 0.8,
                  }}
                >
                  <SchoolIcon
                    sx={{ fontSize: 18, color: theme.palette.success.main }}
                  />{" "}
                  {t("chatbot.settings.learningTitle")}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  component="div"
                  sx={{ lineHeight: 1.6 }}
                >
                  {t("chatbot.settings.learningBody")}
                </Typography>
                <Box sx={{ mt: 1.5 }}>
                  <Button
                    variant="outlined"
                    color="warning"
                    size="small"
                    startIcon={<DeleteOutlineIcon />}
                    onClick={async () => {
                      try {
                        const res = await clearLearning().unwrap();
                        alert(
                          t("chatbot.settings.clearLearningSuccess", {
                            count: res.deleted,
                          }),
                        );
                      } catch (err) {
                        alert(
                          err?.data?.error ||
                            t("chatbot.settings.clearLearningError"),
                        );
                      }
                    }}
                    sx={{
                      textTransform: "none",
                      fontWeight: 600,
                      borderRadius: 2,
                      fontSize: "0.8rem",
                    }}
                  >
                    {t("chatbot.settings.clearLearning")}
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        ) : (
          <>
            {/* ─── Messages ─── */}
            <Box
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              sx={{
                flex: 1,
                overflowY: "auto",
                py: 2,
                position: "relative",
                "&::-webkit-scrollbar": { width: 6 },
                "&::-webkit-scrollbar-thumb": {
                  bgcolor: alpha(theme.palette.text.primary, 0.15),
                  borderRadius: 3,
                },
              }}
            >
              {messages.length === 0 && !isTyping ? (
                <Box sx={{ textAlign: "center", px: 3, pt: 4 }}>
                  <AutoAwesomeIcon
                    sx={{
                      fontSize: 48,
                      color: theme.palette.primary.main,
                      mb: 2,
                      opacity: 0.7,
                    }}
                  />
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("chatbot.welcomeTitle", {
                      name: userInfo?.name ? `, ${userInfo.name}` : "",
                    })}{" "}
                    👋
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 3 }}
                  >
                    {t("chatbot.welcomeBody")}
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 1,
                      justifyContent: "center",
                    }}
                  >
                    {renderedWelcomeSuggestions}
                  </Box>
                </Box>
              ) : (
                <>
                  {/* Ultra-smooth loading spinner (absolute overlay) */}
                  {isLoadingMore && (
                    <Box
                      sx={{
                        position: "absolute",
                        top: 10,
                        left: 0,
                        right: 0,
                        display: "flex",
                        justifyContent: "center",
                        zIndex: 2,
                        pointerEvents: "none",
                      }}
                    >
                      <CircularProgress
                        size={24}
                        thickness={5}
                        sx={{
                          color: theme.palette.primary.main,
                          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))",
                        }}
                      />
                    </Box>
                  )}

                  {/* End of history indicator */}
                  {!hasMoreRef.current && messages.length > 0 && (
                    <Typography
                      variant="caption"
                      color="text.disabled"
                      sx={{
                        display: "block",
                        textAlign: "center",
                        py: 2,
                        opacity: 0.7,
                      }}
                    >
                      {t("chatbot.historyLoadedAll")}
                    </Typography>
                  )}
                  {renderedMessages}
                </>
              )}

              {/* Live thinking (during streaming) */}
              {isTyping && liveSteps.length > 0 && (
                <LiveThinking theme={theme} steps={liveSteps} t={t} />
              )}
              {renderedLiveDraft}
              {isTyping && liveSteps.length === 0 && !liveDraft && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    px: 2,
                    py: 1,
                  }}
                >
                  <Avatar
                    src={BOT_ICON}
                    sx={{
                      width: 32,
                      height: 32,
                      bgcolor: alpha(theme.palette.primary.main, 0.15),
                    }}
                  />
                  <CircularProgress size={16} />
                </Box>
              )}
              <div ref={messagesEndRef} />

              {/* Scroll-to-bottom button */}
              <Fade in={showScrollBtn}>
                <IconButton
                  onClick={scrollToBottom}
                  size="small"
                  sx={{
                    position: "sticky",
                    bottom: 8,
                    left: "50%",
                    transform: "translateX(-50%)",
                    display: "flex",
                    mx: "auto",
                    width: 32,
                    height: 32,
                    bgcolor: isDark
                      ? alpha(theme.palette.background.paper, 0.85)
                      : alpha("#fff", 0.9),
                    border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                    boxShadow: `0 2px 8px ${alpha("#000", 0.15)}`,
                    backdropFilter: "blur(8px)",
                    color: theme.palette.text.secondary,
                    transition: "all 0.2s",
                    "&:hover": {
                      bgcolor: isDark
                        ? alpha(theme.palette.background.paper, 1)
                        : "#fff",
                      color: theme.palette.primary.main,
                      boxShadow: `0 3px 12px ${alpha(theme.palette.primary.main, 0.2)}`,
                    },
                  }}
                >
                  <KeyboardArrowDownIcon fontSize="small" />
                </IconButton>
              </Fade>
            </Box>

            <Divider />

            {showPageContextPreview ? (
              <Box
                sx={{
                  px: 1.5,
                  py: 0.9,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 0.8,
                  alignItems: "center",
                  bgcolor: isDark
                    ? alpha(theme.palette.info.main, 0.08)
                    : alpha(theme.palette.info.main, 0.05),
                  borderBottom: `1px solid ${alpha(theme.palette.info.main, 0.1)}`,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 800,
                    color: theme.palette.info.main,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {t("chatbot.contextBadge")}
                </Typography>
                <Chip
                  size="small"
                  label={
                    currentPageSnapshot.sectionTitle ||
                    currentPageSnapshot.entityTitle ||
                    document.title
                  }
                />
                {currentPageSnapshot.activeLabels?.slice(0, 2).map((label) => (
                  <Chip key={label} size="small" variant="outlined" label={label} />
                ))}
              </Box>
            ) : null}

            {/* ─── Suggestions (above input) ─── */}
            {messages.length > 0 &&
              !isTyping &&
              dynamicSuggestions.length > 0 && (
                <Box
                  ref={(el) => {
                    if (!el || el._dragInit) return;
                    el._dragInit = true;
                    let isDown = false,
                      startX,
                      scrollLeft,
                      isDragged = false;
                    el.onmousedown = (e) => {
                      isDown = true;
                      isDragged = false;
                      el.style.cursor = "grabbing";
                      startX = e.pageX - el.offsetLeft;
                      scrollLeft = el.scrollLeft;
                    };
                    el.onmouseleave = el.onmouseup = () => {
                      isDown = false;
                      el.style.cursor = "grab";
                    };
                    el.onmousemove = (e) => {
                      if (!isDown) return;
                      const dx = e.pageX - el.offsetLeft - startX;
                      if (Math.abs(dx) > 3) isDragged = true;
                      e.preventDefault();
                      el.scrollLeft = scrollLeft - dx;
                    };
                    // Suppress click after drag
                    el.addEventListener(
                      "click",
                      (e) => {
                        if (isDragged) {
                          e.stopPropagation();
                          e.preventDefault();
                          isDragged = false;
                        }
                      },
                      true,
                    );
                    el.onwheel = (e) => {
                      if (Math.abs(e.deltaY) > 0) {
                        e.preventDefault();
                        el.scrollLeft += e.deltaY;
                      }
                    };
                  }}
                  sx={{
                    display: "flex",
                    gap: 0.8,
                    px: 1.5,
                    py: 1,
                    overflowX: "auto",
                    cursor: "grab",
                    userSelect: "none",
                    "&::-webkit-scrollbar": { display: "none" },
                    scrollbarWidth: "none",
                    bgcolor: isDark
                      ? alpha(theme.palette.background.paper, 0.4)
                      : alpha(theme.palette.grey[50], 0.8),
                  }}
                >
                  {renderedDynamicSuggestions}
                </Box>
              )}

            {/* ─── Input ─── */}
            <Box sx={{ display: "none" }}>
              <Box sx={{ display: "none" }}>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", fontWeight: 700 }}
                >
                  {t("chatbot.reasoner.modeLabel", {}, "Chế độ trả lời")}
                </Typography>
                <Chip
                  size="small"
                  clickable
                  color={reasoningMode === "auto" ? "primary" : "default"}
                  variant={reasoningMode === "auto" ? "filled" : "outlined"}
                  label={t("chatbot.reasoner.autoMode", {}, "Tự động")}
                  onClick={() => setReasoningMode("auto")}
                  sx={{ fontWeight: 700 }}
                />
                <Chip
                  size="small"
                  clickable
                  icon={<PsychologyIcon sx={{ fontSize: 14 }} />}
                  color={reasoningMode === "force_reasoner" ? "primary" : "default"}
                  variant={reasoningMode === "force_reasoner" ? "filled" : "outlined"}
                  label={t("chatbot.reasoner.forceMode", {}, "Suy luận")}
                  onClick={() => setReasoningMode("force_reasoner")}
                  sx={{ fontWeight: 700 }}
                />
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.8,
                    flexShrink: 0,
                  }}
                >
                  <Tooltip
                    title={t("chatbot.reasoner.modeLabel", {}, "Chế độ trả lời")}
                  >
                    <IconButton
                      onClick={(event) => setModeMenuAnchorEl(event.currentTarget)}
                      sx={{
                        width: 44,
                        height: 44,
                        border: `1px solid ${alpha(theme.palette.divider, 0.24)}`,
                        bgcolor: isDark
                          ? alpha(theme.palette.background.default, 0.7)
                          : alpha(theme.palette.grey[100], 0.92),
                        color:
                          reasoningMode === "force_reasoner"
                            ? theme.palette.primary.main
                            : theme.palette.text.secondary,
                        "&:hover": {
                          bgcolor: isDark
                            ? alpha(theme.palette.background.default, 0.92)
                            : "#fff",
                        },
                      }}
                    >
                      <AddRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  {reasoningMode === "force_reasoner" ? (
                    <Chip
                      size="small"
                      icon={<PsychologyIcon sx={{ fontSize: 14 }} />}
                      label={t("chatbot.reasoner.forceMode", {}, "Suy luận")}
                      onDelete={() => setReasoningMode("auto")}
                      color="primary"
                      variant="filled"
                      sx={{
                        fontWeight: 700,
                        height: 40,
                        borderRadius: 999,
                        "& .MuiChip-label": {
                          px: 1.15,
                        },
                      }}
                    />
                  ) : null}
                </Box>
              <TextField
                inputRef={inputRef}
                fullWidth
                multiline
                maxRows={3}
                size="small"
                placeholder={t("chatbot.inputPlaceholder")}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 3,
                    minHeight: 44,
                    alignItems: "center",
                    bgcolor: isDark
                      ? alpha(theme.palette.background.default, 0.5)
                      : alpha(theme.palette.grey[100], 0.8),
                    fontSize: "0.875rem",
                    py: 0.25,
                    "& fieldset": { borderColor: "transparent" },
                    "&:hover fieldset": {
                      borderColor: alpha(theme.palette.primary.main, 0.3),
                    },
                    "&.Mui-focused fieldset": {
                      borderColor: theme.palette.primary.main,
                      borderWidth: 1,
                    },
                  },
                }}
              />
              <IconButton
                onClick={isTyping ? handleStopStreaming : () => handleSend()}
                disabled={isTyping ? false : !input.trim()}
                sx={{
                  bgcolor: isTyping
                    ? theme.palette.error.main
                    : theme.palette.primary.main,
                  color: "#fff",
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  "&:hover": {
                    bgcolor: isTyping
                      ? theme.palette.error.dark
                      : theme.palette.primary.dark,
                  },
                  "&.Mui-disabled": {
                    bgcolor: alpha(theme.palette.primary.main, 0.3),
                    color: "rgba(255,255,255,0.5)",
                  },
                }}
              >
                {isTyping ? (
                  <StopCircleIcon sx={{ fontSize: 20 }} />
                ) : (
                  <SendIcon sx={{ fontSize: 20 }} />
                )}
              </IconButton>
              </Box>
            </Box>
          </>
        )}
            {sessionFocusOverrideMeta && !showSettings && (
              <Box sx={{ px: 2, pb: 0.8 }}>
                <Chip
                  size="small"
                  label={sessionFocusOverrideMeta.label}
                  onDelete={() => {
                    void handleResetSessionFocusOverride();
                  }}
                  color={sessionFocusOverrideMeta.color}
                  variant="outlined"
                  sx={{
                    maxWidth: "100%",
                    height: 28,
                    fontWeight: 700,
                    ".MuiChip-label": {
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                  }}
                />
              </Box>
            )}
            {!showSettings && (
              <ChatComposer
                open={open}
                isTyping={isTyping}
                theme={theme}
                t={t}
                onSend={handleSend}
                onStop={handleStopStreaming}
                reasoningMode={reasoningMode}
                assistantMode={assistantMode}
                verificationMode={verificationMode}
                onReasoningModeChange={handleComposerModeChange}
                onAssistantModeChange={handleComposerAssistantModeChange}
                onVerificationModeChange={handleComposerVerificationModeChange}
              />
            )}
      </Drawer>

      <Menu
        anchorEl={modeMenuAnchorEl}
        open={modeMenuOpen}
        onClose={() => setModeMenuAnchorEl(null)}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        PaperProps={{
          sx: {
            borderRadius: 3,
            minWidth: 220,
            mt: -0.5,
            boxShadow: `0 18px 42px ${alpha("#000", 0.18)}`,
          },
        }}
      >
        <MenuItem
          selected={reasoningMode === "auto"}
          onClick={() => {
            setReasoningMode("auto");
            setModeMenuAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {reasoningMode === "auto" ? (
              <DoneRoundedIcon color="primary" fontSize="small" />
            ) : (
              <AutoAwesomeIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={t("chatbot.reasoner.autoMode", {}, "Tự động")}
          />
        </MenuItem>
        <MenuItem
          selected={reasoningMode === "force_reasoner"}
          onClick={() => {
            setReasoningMode("force_reasoner");
            setModeMenuAnchorEl(null);
          }}
        >
          <ListItemIcon>
            {reasoningMode === "force_reasoner" ? (
              <DoneRoundedIcon color="primary" fontSize="small" />
            ) : (
              <PsychologyIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={t("chatbot.reasoner.forceMode", {}, "Suy luận")}
          />
        </MenuItem>
      </Menu>

      {/* ═══ Confirm Clear Dialog ═══ */}
      <Dialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        PaperProps={{
          sx: { borderRadius: 3, maxWidth: 360 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1rem", pb: 0.5 }}>
          {t("chatbot.confirmClearTitle")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: "0.875rem" }}>
            {t("chatbot.confirmClearBody")}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setConfirmClearOpen(false)}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            onClick={handleClear}
            color="error"
            variant="contained"
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 2 }}
          >
            {t("common.actions.delete")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(pendingActionConfirm)}
        onClose={() => setPendingActionConfirm(null)}
        PaperProps={{
          sx: { borderRadius: 3, maxWidth: 380 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1rem", pb: 0.5 }}>
          {pendingActionConfirm?.action?.confirmTitle ||
            t("chatbot.confirmActionTitle", {}, "Xác nhận thao tác")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: "0.875rem" }}>
            {pendingActionConfirm?.action?.confirmBody ||
              pendingActionConfirm?.action?.description ||
              t(
                "chatbot.confirmActionBody",
                {},
                "Pikora muốn chạy thao tác này trên trang hiện tại. Bạn có muốn tiếp tục không?",
              )}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setPendingActionConfirm(null)}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="contained"
            sx={{ textTransform: "none", fontWeight: 700, borderRadius: 2 }}
            onClick={async () => {
              const pending = pendingActionConfirm;
              setPendingActionConfirm(null);
              if (!pending?.action) return;
              try {
                await executeChatAction(pending.action, pending.msg);
              } catch (error) {
                await logChatClientEvent({
                  messageId: pending.msg?.id || pending.action?.messageId,
                  type: "action_unsupported",
                  label: getChatActionLabel(pending.action, t),
                  actionType: pending.action?.type || "",
                  success: false,
                  detail: error?.message || t("chatbot.actions.unsupported"),
                });
              }
            }}
          >
            {pendingActionConfirm?.action?.label || t("chatbot.actions.run")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(pendingWorkflowConfirm)}
        onClose={() => setPendingWorkflowConfirm(null)}
        PaperProps={{
          sx: { borderRadius: 3, maxWidth: 420 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1rem", pb: 0.5 }}>
          {pendingWorkflowConfirm?.workflow?.title || "Xác nhận workflow"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: "0.875rem", mb: 1 }}>
            {pendingWorkflowConfirm?.workflow?.summary ||
              "Pikora sẽ chạy một chuỗi thao tác nhẹ, an toàn trên trang hiện tại."}
          </DialogContentText>
          <Box sx={{ display: "grid", gap: 0.7 }}>
            {(pendingWorkflowConfirm?.workflow?.steps || []).slice(0, 3).map((step, index) => (
              <Typography
                key={step.id || `wf-step-${index}`}
                variant="caption"
                sx={{ color: "text.secondary" }}
              >
                {index + 1}. {step.title}
              </Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={async () => {
              const pending = pendingWorkflowConfirm;
              setPendingWorkflowConfirm(null);
              await logChatClientEvent({
                messageId: pending?.msg?.id,
                type: "workflow_unsupported",
                label: pending?.workflow?.title || "workflow",
                actionType: "workflow",
                success: false,
                detail: "cancelled_by_user",
              });
            }}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="contained"
            sx={{ textTransform: "none", fontWeight: 700, borderRadius: 2 }}
            onClick={async () => {
              const pending = pendingWorkflowConfirm;
              setPendingWorkflowConfirm(null);
              if (!pending?.workflow) return;
              try {
                await executeWorkflow(pending.workflow, pending.msg);
              } catch {
                // already logged
              }
            }}
          >
            {pendingWorkflowConfirm?.workflow?.runLabel || "Chạy workflow"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(pendingMutationConfirm)}
        onClose={() => setPendingMutationConfirm(null)}
        PaperProps={{
          sx: { borderRadius: 3, maxWidth: 420 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1rem", pb: 0.5 }}>
          {pendingMutationConfirm?.mutationPreview?.title ||
            "Xác nhận thay đổi nhẹ"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: "0.875rem", mb: 1 }}>
            {pendingMutationConfirm?.mutationPreview?.summary ||
              "Pikora sẽ lưu một thay đổi nhẹ, có thể hoàn tác hoặc xóa sau."}
          </DialogContentText>
          <Box sx={{ display: "grid", gap: 0.7 }}>
            {(pendingMutationConfirm?.mutationPreview?.changes || [])
              .slice(0, 3)
              .map((change, index) => (
                <Typography
                  key={`mutation-change-${index}`}
                  variant="caption"
                  sx={{ color: "text.secondary" }}
                >
                  • {change}
                </Typography>
              ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={async () => {
              const pending = pendingMutationConfirm;
              setPendingMutationConfirm(null);
              await logChatClientEvent({
                messageId: pending?.msg?.id,
                type: "mutation_cancelled",
                label:
                  pending?.mutationPreview?.title ||
                  pending?.mutationPreview?.type ||
                  "mutation",
                actionType: pending?.mutationPreview?.type || "",
                success: false,
                detail: "cancelled_by_user",
              });
            }}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="contained"
            color="warning"
            sx={{ textTransform: "none", fontWeight: 700, borderRadius: 2 }}
            onClick={async () => {
              const pending = pendingMutationConfirm;
              setPendingMutationConfirm(null);
              if (!pending?.mutationPreview) return;
              try {
                await commitLightMutation(
                  pending.mutationPreview,
                  pending.msg,
                );
              } catch (error) {
                await logChatClientEvent({
                  messageId: pending?.msg?.id,
                  type: "mutation_cancelled",
                  label:
                    pending?.mutationPreview?.title ||
                    pending?.mutationPreview?.type ||
                    "mutation",
                  actionType: pending?.mutationPreview?.type || "",
                  success: false,
                  detail: error?.message || "mutation_failed",
                });
              }
            }}
          >
            {"Xác nhận lưu"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(feedbackDialog)}
        onClose={() => {
          setFeedbackDialog(null);
          setFeedbackReason("");
          setFeedbackNote("");
        }}
        PaperProps={{
          sx: { borderRadius: 3, maxWidth: 420 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1rem", pb: 0.5 }}>
          {t("chatbot.feedbackTitle", {}, "Điều gì chưa ổn?")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: "0.875rem", mb: 1.5 }}>
            {t(
              "chatbot.feedbackBody",
              {},
              "Chọn lý do chính để mình tối ưu Pikora tốt hơn cho những lần trả lời sau.",
            )}
          </DialogContentText>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.8, mb: 1.5 }}>
            {[
              "Sai ngữ cảnh",
              "Sai dữ liệu",
              "Chậm",
              "Khó hiểu",
              "Không làm đúng thao tác",
            ].map((reason) => (
              <Chip
                key={reason}
                label={reason}
                clickable
                color={feedbackReason === reason ? "error" : "default"}
                variant={feedbackReason === reason ? "filled" : "outlined"}
                onClick={() => setFeedbackReason(reason)}
              />
            ))}
          </Box>
          <TextField
            fullWidth
            multiline
            minRows={3}
            size="small"
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
            placeholder={t(
              "chatbot.feedbackPlaceholder",
              {},
              "Ghi thêm một chút để mình sửa đúng chỗ cần thiết...",
            )}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              setFeedbackDialog(null);
              setFeedbackReason("");
              setFeedbackNote("");
            }}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={
              feedbackSubmittingId === feedbackDialog?.messageId ||
              (!feedbackReason && !feedbackNote.trim())
            }
            onClick={handleSubmitNegativeFeedback}
            sx={{ textTransform: "none", fontWeight: 700, borderRadius: 2 }}
          >
            {feedbackSubmittingId === feedbackDialog?.messageId
              ? t("common.status.loading", {}, "Đang gửi...")
              : t("chatbot.feedbackSubmit", {}, "Gửi phản hồi")}
          </Button>
        </DialogActions>
      </Dialog>

      <ReasonerDialog
        open={Boolean(reasonerMessage)}
        message={reasonerMessage}
        onClose={() => setReasonerMessage(null)}
        theme={theme}
        t={t}
      />
    </>
  );
}
