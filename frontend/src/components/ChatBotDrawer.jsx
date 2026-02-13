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
  Chip,
  Collapse,
  useMediaQuery,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import SendIcon from "@mui/icons-material/Send";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useClearChatHistoryMutation, chatBotApiSlice } from "../slices/chatBotApiSlice";
import { useSelector } from "react-redux";
import { useNavigate as useRouterNavigate } from "react-router-dom";

const BOT_ICON = "/icon-chatbot.png";



// ─── Initial Suggestions (only for welcome screen) ───
const GUEST_SUGGESTIONS = [
  "Pickleball là gì?",
  "Cách đăng ký tài khoản",
  "Giải đấu sắp tới?",
  "Hướng dẫn đăng ký giải",
];
const LOGGED_IN_SUGGESTIONS = [
  "Điểm rating của tôi?",
  "Giải đấu tôi đã đăng ký?",
  "Thống kê trận đấu của tôi",
  "Giải đấu sắp tới?",
];
function getWelcomeSuggestions(userInfo) {
  return userInfo ? LOGGED_IN_SUGGESTIONS : GUEST_SUGGESTIONS;
}

// ═══════════════════════════════════════════
//  Markdown Renderer
// ═══════════════════════════════════════════
const MarkdownContent = memo(function MarkdownContent({ text, theme, onLinkClick }) {
  const isDark = theme.palette.mode === "dark";
  const navigate = useRouterNavigate();
  const components = useMemo(
    () => ({
      a: ({ href, children }) => {
        if (!href) return <span>{children}</span>;

        // Normalize: strip origin if it's same-site (react-markdown may resolve relative URLs)
        let path = href;
        try {
          const url = new URL(href, window.location.origin);
          if (url.origin === window.location.origin) {
            path = url.pathname + url.search + url.hash;
          }
        } catch {
          // not a valid URL, treat as relative path
        }

        // Internal link: relative path or known internal routes
        const isInternal =
          !path.startsWith("http") && !path.startsWith("mailto:");
        if (isInternal) {
          const normalizedPath = path.startsWith("/") ? path : `/${path}`;
          return (
            <Box
              component="span"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onLinkClick?.();
                navigate(normalizedPath);
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
                (c) => c?.props?.node?.tagName === "th" || c?.type === "th"
              );
              if (isHeader || headers.length === 0) {
                headers = texts;
              } else {
                rows.push(texts);
                // Keep original cell children for rendering links in card mode
                rowNodes.push(cells.map((c) => c?.props?.children ?? extractText(c)));
              }
            });
          });
        });

        const colCount = headers.length;

        // ─── CARD MODE (> 3 columns) ───
        if (colCount > 3) {
          return (
            <Box sx={{ my: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
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
                        sx={{ fontSize: "0.8rem", lineHeight: 1.5, wordBreak: "break-word" }}
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
                  bgcolor: alpha(theme.palette.primary.main, isDark ? 0.18 : 0.07),
                  fontWeight: 700,
                  fontSize: "0.72rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                  color: isDark ? theme.palette.primary.light : theme.palette.primary.dark,
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
                  bgcolor: alpha(theme.palette.primary.main, isDark ? 0.08 : 0.03),
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
    [theme, isDark]
  );

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});

// ═══════════════════════════════════════════
//  Thinking Block (collapsible, giống Claude)
// ═══════════════════════════════════════════
const ThinkingBlock = memo(function ThinkingBlock({ steps, theme, isActive, processingTime }) {
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
            ? "Đang xử lý..."
            : `Hoàn tất${
                processingTime
                  ? ` trong ${(processingTime / 1000).toFixed(1)}s`
                  : ""
              }`}
        </Typography>
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
              0.3
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
        </Box>
      </Collapse>
    </Box>
  );
});

// ═══════════════════════════════════════════
//  Message Bubble
// ═══════════════════════════════════════════
const MessageBubble = memo(function MessageBubble({ msg, theme, onNavigate, onClose }) {
  const isBot = msg.role === "bot" || msg.role === "assistant";
  const isDark = theme.palette.mode === "dark";

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isBot ? "flex-start" : "flex-end",
        mb: 1.5,
        px: 1,
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
      <Box sx={{ maxWidth: "85%", minWidth: 0 }}>
        {/* Thinking block (hiện trên reply) */}
        {isBot && msg.thinkingSteps?.length > 0 && (
          <ThinkingBlock
            steps={msg.thinkingSteps}
            theme={theme}
            isActive={false}
            processingTime={msg.processingTime}
          />
        )}

        <Box
          sx={{
            px: 2,
            py: 1.2,
            borderRadius: isBot
              ? "4px 16px 16px 16px"
              : "16px 16px 4px 16px",
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
              ? "none"
              : `0 2px 8px ${alpha(theme.palette.primary.main, 0.3)}`,
            overflow: "hidden",
          }}
        >
          {isBot ? (
            <MarkdownContent text={msg.text} theme={theme} onLinkClick={onClose} />
          ) : (
            msg.text
          )}
        </Box>

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
              borderRadius: 2,
              cursor: "pointer",
              fontSize: "0.78rem",
              fontWeight: 600,
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
            {msg.navigation.description || "Mở trang"}
          </Box>
        )}
      </Box>
    </Box>
  );
});

// ═══════════════════════════════════════════
//  Active Thinking Indicator (live streaming)
// ═══════════════════════════════════════════
function LiveThinking({ theme, steps }) {
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
        <ThinkingBlock
          steps={steps}
          theme={theme}
          isActive={true}
        />
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════
//  SSE Stream Parser
// ═══════════════════════════════════════════
async function sendMessageStream(message, onEvent) {
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
  const courtMatch = pathname.match(/\/(?:streaming|live-studio)\/([a-f0-9]{24})/i);
  if (courtMatch) headers["x-pkt-court-id"] = courtMatch[1];

  // Always send current path for context
  headers["x-pkt-current-path"] = pathname;

  const res = await fetch(`${base}/api/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

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
export default function ChatBotDrawer() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const isDark = theme.palette.mode === "dark";
  const routerNavigate = useRouterNavigate();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [liveSteps, setLiveSteps] = useState([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [dynamicSuggestions, setDynamicSuggestions] = useState([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  const { userInfo } = useSelector((state) => state.auth);
  const [clearHistory] = useClearChatHistoryMutation();
  const [fetchHistory] = chatBotApiSlice.useLazyGetChatHistoryQuery();
  const historyLoaded = useRef(false);
  const nextCursorRef = useRef(null);
  const hasMoreRef = useRef(true);

  // ─── Map backend message to frontend format ───
  const mapMessage = useCallback((m) => ({
    id: m.id,
    role: m.role === "user" ? "user" : "bot",
    text: m.message || "",
    toolsUsed: m.meta?.toolsUsed || [],
    processingTime: m.meta?.processingTime || null,
    thinkingSteps: m.meta?.thinkingSteps || [],
    navigation: m.navigation || null,
  }), []);

  // Instant jump (no animation) — used for initial history load
  const jumpToBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Smooth scroll — used when user sends/receives new messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

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
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "bot")
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

  const handleChatNavigate = useCallback((path) => {
    setOpen(false);
    routerNavigate(path);
  }, [routerNavigate]);

  const handleCloseDrawer = useCallback(() => setOpen(false), []);

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
    if (el.scrollTop < 60 && hasMoreRef.current && !isLoadingMore && !isPrependingRef.current) {
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
  }, [isTyping, liveSteps, messages.length, scrollToBottom]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300);
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
            .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "bot")
            .map(mapMessage);
          if (mapped.length) setMessages(mapped);

          // Restore suggestions from the last bot message
          const lastBotMsg = [...res.messages].reverse().find((m) => m.role === "bot");
          if (lastBotMsg?.meta?.suggestions?.length) {
            setDynamicSuggestions(lastBotMsg.meta.suggestions);
          }
        }
        nextCursorRef.current = res?.nextCursor || null;
        hasMoreRef.current = !!res?.hasMore;
      } catch { /* ignore - guest users */ }
      // Instant jump to bottom after history loads (no animation)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          jumpToBottom();
          isPrependingRef.current = false;
        });
      });
    })();
  }, [open, userInfo, fetchHistory, mapMessage, jumpToBottom]);

  // ─── Send message via SSE stream ───
  const handleSend = async (overrideText) => {
    const text = (overrideText || input).trim();
    if (!text || isTyping) return;

    setInput("");
    userJustSentRef.current = true;
    isNearBottomRef.current = true;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setIsTyping(true);
    setLiveSteps([]);
    setDynamicSuggestions([]);

    // Collect steps during stream
    const collectedSteps = [];
    let replyData = null;

    try {
      await sendMessageStream(text, (event, data) => {
        switch (event) {
          case "thinking": {
            const step = {
              label: data.step,
              status: "running",
            };
            collectedSteps.push(step);
            setLiveSteps([...collectedSteps]);
            // Mark previous running steps as done
            collectedSteps.forEach((s, i) => {
              if (i < collectedSteps.length - 1 && s.status === "running") {
                s.status = "done";
              }
            });
            break;
          }
          case "tool_start": {
            // Mark previous running ones as done
            collectedSteps.forEach((s) => {
              if (s.status === "running") s.status = "done";
            });
            const label = data.label || data.tool;
            collectedSteps.push({
              label: `${label}...`,
              status: "running",
              tool: data.tool,
            });
            setLiveSteps([...collectedSteps]);
            break;
          }
          case "tool_done": {
            // Find the running step for this tool and update it
            const idx = collectedSteps.findLastIndex(
              (s) => s.tool === data.tool && s.status === "running"
            );
            if (idx !== -1) {
              collectedSteps[idx] = {
                ...collectedSteps[idx],
                label: data.resultPreview || data.label || data.tool,
                status: "done",
                durationMs: data.durationMs,
                error: data.error || false,
              };
            }
            setLiveSteps([...collectedSteps]);
            break;
          }
          case "reply": {
            // Mark all as done
            collectedSteps.forEach((s) => {
              if (s.status === "running") s.status = "done";
            });
            replyData = data;
            break;
          }
          case "error": {
            collectedSteps.forEach((s) => {
              if (s.status === "running") {
                s.status = "done";
                s.error = true;
              }
            });
            replyData = {
              text: `❌ ${data.message || "Có lỗi xảy ra"}`,
              toolsUsed: [],
              processingTime: null,
            };
            break;
          }
          case "suggestions": {
            if (Array.isArray(data.suggestions)) {
              setDynamicSuggestions(data.suggestions);
            }
            break;
          }
          case "done":
            break;
        }
      });

      // Add bot message with thinking steps
      if (replyData) {
        setMessages((prev) => [
          ...prev,
          {
            role: "bot",
            text: replyData.text,
            toolsUsed: replyData.toolsUsed || [],
            processingTime: replyData.processingTime || null,
            thinkingSteps: collectedSteps,
            navigation: replyData.navigation || null,
          },
        ]);
      }
    } catch (err) {
      let errorText = "❌ Có lỗi xảy ra, bạn thử lại nhé!";
      if (err.message?.includes("session_limit_reached") || err.message?.includes("429")) {
        errorText = "⏳ Bạn đã hết lượt hỏi cho phiên này. Vui lòng thử lại sau nhé!";
      } else if (err.message) {
        errorText = `❌ ${err.message}`;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text: errorText,
          thinkingSteps: collectedSteps,
        },
      ]);
    } finally {
      setIsTyping(false);
      setLiveSteps([]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = async () => {
    setConfirmClearOpen(false);
    try {
      await clearHistory().unwrap();
    } catch { /* ignore */ }
    setMessages([]);
    setDynamicSuggestions([]);
    historyLoaded.current = false;
    nextCursorRef.current = null;
    hasMoreRef.current = true;
  };

  const drawerWidth = isMobile ? "100vw" : 420;

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
              Pikora
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.85 }}>
              {isTyping ? "Đang xử lý..." : "Trợ lý ảo PickleTour 🏓"}
            </Typography>
          </Box>
          <Tooltip title="Xóa lịch sử chat">
            <IconButton
              size="small"
              onClick={() => setConfirmClearOpen(true)}
              sx={{ color: "rgba(255,255,255,0.7)", "&:hover": { color: "#fff" } }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Đóng">
            <IconButton
              size="small"
              onClick={() => setOpen(false)}
              sx={{ color: "rgba(255,255,255,0.7)", "&:hover": { color: "#fff" } }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>

        <Divider />

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
                Xin chào{userInfo?.name ? `, ${userInfo.name}` : ""}! 👋
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 3 }}
              >
                Mình là Pikora - trợ lý ảo của PickleTour. Hỏi mình bất cứ gì
                về giải đấu, rating, VĐV nhé!
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 1,
                  justifyContent: "center",
                }}
              >
                {getWelcomeSuggestions(userInfo).map((text) => (
                  <Box
                    key={text}
                    onClick={() => handleSend(text)}
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
                ))}
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
                  sx={{ display: "block", textAlign: "center", py: 2, opacity: 0.7 }}
                >
                  — Đã tải hết lịch sử —
                </Typography>
              )}
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id || `msg-${i}`}
                  msg={msg}
                  theme={theme}
                  onNavigate={handleChatNavigate}
                  onClose={handleCloseDrawer}
                />
              ))}
            </>
          )}

          {/* Live thinking (during streaming) */}
          {isTyping && liveSteps.length > 0 && (
            <LiveThinking theme={theme} steps={liveSteps} />
          )}
          {isTyping && liveSteps.length === 0 && (
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

        {/* ─── Suggestions (above input) ─── */}
        {messages.length > 0 && !isTyping && dynamicSuggestions.length > 0 && (
          <Box
            ref={(el) => {
              if (!el || el._dragInit) return;
              el._dragInit = true;
              let isDown = false, startX, scrollLeft, isDragged = false;
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
              el.addEventListener("click", (e) => {
                if (isDragged) {
                  e.stopPropagation();
                  e.preventDefault();
                  isDragged = false;
                }
              }, true);
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
            {dynamicSuggestions.map((text) => (
              <Box
                key={text}
                onClick={() => handleSend(text)}
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
            ))}
          </Box>
        )}

        {/* ─── Input ─── */}
        <Box
          sx={{
            p: 1.5,
            display: "flex",
            alignItems: "flex-end",
            gap: 1,
            bgcolor: isDark
              ? alpha(theme.palette.background.paper, 0.6)
              : "#fff",
          }}
        >
          <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={3}
            size="small"
            placeholder="Nhập tin nhắn..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isTyping}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: 3,
                bgcolor: isDark
                  ? alpha(theme.palette.background.default, 0.5)
                  : alpha(theme.palette.grey[100], 0.8),
                fontSize: "0.875rem",
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
            onClick={() => handleSend()}
            disabled={!input.trim() || isTyping}
            sx={{
              bgcolor: theme.palette.primary.main,
              color: "#fff",
              width: 40,
              height: 40,
              "&:hover": { bgcolor: theme.palette.primary.dark },
              "&.Mui-disabled": {
                bgcolor: alpha(theme.palette.primary.main, 0.3),
                color: "rgba(255,255,255,0.5)",
              },
            }}
          >
            {isTyping ? (
              <CircularProgress size={20} sx={{ color: "#fff" }} />
            ) : (
              <SendIcon sx={{ fontSize: 20 }} />
            )}
          </IconButton>
        </Box>
      </Drawer>

      {/* ═══ Confirm Clear Dialog ═══ */}
      <Dialog
        open={confirmClearOpen}
        onClose={() => setConfirmClearOpen(false)}
        PaperProps={{
          sx: { borderRadius: 3, maxWidth: 360 },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1rem", pb: 0.5 }}>
          Xóa lịch sử chat? 🗑️
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: "0.875rem" }}>
            Toàn bộ tin nhắn sẽ bị xóa và không thể khôi phục. Bạn có chắc
            chắn muốn xóa?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setConfirmClearOpen(false)}
            sx={{ textTransform: "none", fontWeight: 600 }}
          >
            Hủy
          </Button>
          <Button
            onClick={handleClear}
            color="error"
            variant="contained"
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 2 }}
          >
            Xóa
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
