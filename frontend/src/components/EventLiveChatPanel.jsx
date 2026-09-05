// components/EventLiveChatPanel.jsx
// Bình luận realtime trên trang xem live event
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useSelector } from "react-redux";
import {
  useGetEventLiveCommentsQuery,
  usePostEventLiveCommentMutation,
} from "../slices/eventLiveApiSlice";

const MAX_LEN = 500;
const HEARTBEAT_INTERVAL = 30_000;

export default function EventLiveChatPanel({ socket }) {
  const user = useSelector((s) => s.auth?.userInfo);
  const [comments, setComments] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const oldestRef = useRef(null);

  // Initial load
  const { data: initial, isLoading } = useGetEventLiveCommentsQuery({
    limit: 30,
  });
  const [postComment] = usePostEventLiveCommentMutation();

  // Hydrate initial comments
  useEffect(() => {
    if (initial?.comments) {
      setComments(initial.comments);
      setHasMore(initial.hasMore);
      oldestRef.current = initial.oldestAt;
    }
  }, [initial]);

  // Socket.IO — subscribe to chat & viewer presence
  useEffect(() => {
    if (!socket) return;

    socket.emit("event-live:chat:subscribe");
    socket.emit("event-live:viewer:join", { platform: "web" });

    const onNew = (c) => {
      setComments((prev) => {
        if (prev.some((x) => x._id === c._id)) return prev;
        return [...prev, c];
      });
    };
    const onDeleted = ({ _id }) => {
      setComments((prev) => prev.filter((c) => c._id !== _id));
    };

    socket.on("event-live:comment:new", onNew);
    socket.on("event-live:comment:deleted", onDeleted);

    // Heartbeat
    const hb = setInterval(() => {
      socket.emit("event-live:viewer:ping");
    }, HEARTBEAT_INTERVAL);

    return () => {
      socket.emit("event-live:viewer:leave");
      socket.emit("event-live:chat:unsubscribe");
      socket.off("event-live:comment:new", onNew);
      socket.off("event-live:comment:deleted", onDeleted);
      clearInterval(hb);
    };
  }, [socket]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [comments, autoScroll]);

  // Detect scroll position
  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(nearBottom);
  }, []);

  // Load older
  const loadOlder = async () => {
    if (!oldestRef.current || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/event-live/comments?before=${oldestRef.current}&limit=30`,
      );
      const data = await res.json();
      if (data.comments?.length) {
        setComments((prev) => [...data.comments, ...prev]);
        setHasMore(data.hasMore);
        oldestRef.current = data.oldestAt;
      } else {
        setHasMore(false);
      }
    } catch {
      /* ignore */
    }
    setLoadingOlder(false);
  };

  // Send comment
  const doSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      // Prefer socket for lower latency
      if (socket?.connected) {
        await new Promise((resolve, reject) => {
          socket.emit(
            "event-live:comment:send",
            { content: text, platform: "web" },
            (ack) => {
              if (ack?.ok) resolve(ack);
              else reject(new Error(ack?.error || "failed"));
            },
          );
          // timeout fallback
          setTimeout(() => reject(new Error("timeout")), 5000);
        });
      } else {
        await postComment({ content: text }).unwrap();
      }
      setInput("");
    } catch {
      // Fallback to REST
      try {
        await postComment({ content: text }).unwrap();
        setInput("");
      } catch {
        /* best effort */
      }
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const fmtTime = (d) => {
    try {
      return new Date(d).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 300,
        maxHeight: { xs: 360, md: "100%" },
        bgcolor: "rgba(0,0,0,0.3)",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <Typography
          variant="subtitle2"
          sx={{ color: "#fff", fontWeight: 700 }}
        >
          💬 Bình luận trực tiếp
        </Typography>
      </Box>

      {/* Messages */}
      <Box
        ref={listRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflowY: "auto",
          px: 1.5,
          py: 1,
          "&::-webkit-scrollbar": { width: 4 },
          "&::-webkit-scrollbar-thumb": {
            bgcolor: "rgba(255,255,255,0.2)",
            borderRadius: 2,
          },
        }}
      >
        {hasMore && (
          <Box textAlign="center" mb={1}>
            <Button
              size="small"
              onClick={loadOlder}
              disabled={loadingOlder}
              sx={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }}
            >
              {loadingOlder ? (
                <CircularProgress size={14} sx={{ mr: 0.5 }} />
              ) : null}
              Xem cũ hơn
            </Button>
          </Box>
        )}

        {isLoading && (
          <Box textAlign="center" py={3}>
            <CircularProgress size={24} sx={{ color: "#fff" }} />
          </Box>
        )}

        {comments.map((c) => (
          <Stack
            key={c._id}
            direction="row"
            spacing={1}
            alignItems="flex-start"
            sx={{ mb: 0.8 }}
          >
            <Avatar
              src={c.user?.avatar}
              sx={{ width: 26, height: 26, mt: 0.3 }}
            >
              {(c.user?.name || "?")[0]}
            </Avatar>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={0.5} alignItems="baseline">
                <Typography
                  variant="caption"
                  sx={{ color: "#4dd0e1", fontWeight: 700, fontSize: 12 }}
                >
                  {c.user?.nickName ||
                    c.user?.nickname ||
                    c.user?.fullName ||
                    c.user?.name ||
                    "Ẩn danh"}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}
                >
                  {fmtTime(c.createdAt)}
                </Typography>
              </Stack>
              <Typography
                variant="body2"
                sx={{
                  color: "rgba(255,255,255,0.9)",
                  fontSize: 13,
                  lineHeight: 1.4,
                  wordBreak: "break-word",
                }}
              >
                {c.content}
              </Typography>
            </Box>
          </Stack>
        ))}

        <div ref={bottomRef} />
      </Box>

      {/* Scroll-to-bottom fab */}
      {!autoScroll && (
        <Box sx={{ textAlign: "center", mt: -3.5, position: "relative", zIndex: 2 }}>
          <IconButton
            size="small"
            onClick={() => {
              setAutoScroll(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            sx={{
              bgcolor: "rgba(0,0,0,0.6)",
              color: "#fff",
              "&:hover": { bgcolor: "rgba(0,0,0,0.8)" },
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {/* Input */}
      <Box sx={{ px: 1.5, py: 1, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
        {user ? (
          <TextField
            fullWidth
            size="small"
            placeholder="Nhập bình luận…"
            value={input}
            onChange={(e) =>
              setInput(e.target.value.length <= MAX_LEN ? e.target.value : e.target.value.slice(0, MAX_LEN))
            }
            onKeyDown={handleKeyDown}
            disabled={sending}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={doSend}
                      disabled={!input.trim() || sending}
                      size="small"
                      sx={{ color: "#4dd0e1" }}
                    >
                      {sending ? (
                        <CircularProgress size={18} />
                      ) : (
                        <SendIcon fontSize="small" />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                bgcolor: "rgba(255,255,255,0.08)",
                color: "#fff",
                borderRadius: 2,
                fontSize: 13,
                "& fieldset": { borderColor: "rgba(255,255,255,0.15)" },
                "&:hover fieldset": { borderColor: "rgba(255,255,255,0.3)" },
                "&.Mui-focused fieldset": { borderColor: "#4dd0e1" },
              },
              "& .MuiOutlinedInput-input::placeholder": {
                color: "rgba(255,255,255,0.4)",
              },
            }}
          />
        ) : (
          <Typography
            variant="caption"
            sx={{ color: "rgba(255,255,255,0.5)", textAlign: "center", display: "block" }}
          >
            Đăng nhập để bình luận
          </Typography>
        )}
      </Box>
    </Box>
  );
}
