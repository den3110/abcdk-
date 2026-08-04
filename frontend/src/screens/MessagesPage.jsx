// screens/MessagesPage.jsx — Nhắn tin (web) 2 pane: sidebar conversations + main chat.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Send, Trash2 } from "lucide-react";
import { useSelector } from "react-redux";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import SEOHead from "../components/SEOHead.jsx";
import {
  useListConversationsQuery,
  useListMessagesQuery,
  useSendMessageMutation,
  useMarkReadMutation,
  useDeleteMessageMutation,
  useUploadChatMediaMutation,
} from "../slices/messagesApiSlice.js";

const authorName = (u) => u?.nickname || u?.name || "Người dùng";
const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ`;
  return d.toLocaleDateString("vi-VN");
};

function ConversationRow({ conv, me, active, onSelect }) {
  const other = conv.otherParticipants?.[0];
  const title =
    conv.type === "tournament"
      ? `BTC · ${conv.tournament?.name || "Giải đấu"}`
      : authorName(other);
  const preview =
    conv.lastMessage?.text ||
    (conv.lastMessage?.hasAttachment ? "📎 Đính kèm" : "Chưa có tin nhắn");
  return (
    <Box
      onClick={onSelect}
      sx={{
        cursor: "pointer",
        px: 2,
        py: 1.25,
        display: "flex",
        gap: 1.5,
        alignItems: "center",
        bgcolor: active ? "action.selected" : "transparent",
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Badge
        color="error"
        badgeContent={conv.unread > 0 ? conv.unread : 0}
        max={99}
        invisible={!conv.unread}
      >
        <Avatar
          src={other?.avatar || ""}
          sx={{
            bgcolor: conv.type === "tournament" ? "warning.main" : "primary.main",
          }}
        >
          {title[0]?.toUpperCase()}
        </Avatar>
      </Badge>
      <Box flex={1} minWidth={0}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography
            variant="body2"
            fontWeight={conv.unread > 0 ? 800 : 600}
            noWrap
          >
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {fmtTime(conv.lastMessageAt)}
          </Typography>
        </Stack>
        <Typography
          variant="body2"
          color={conv.unread > 0 ? "text.primary" : "text.secondary"}
          noWrap
          sx={{ fontWeight: conv.unread > 0 ? 600 : 400 }}
        >
          {preview}
        </Typography>
      </Box>
    </Box>
  );
}

function MessageBubble({ msg, isMine, onDelete, canDelete }) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isMine ? "flex-end" : "flex-start",
        my: 0.5,
      }}
    >
      <Box
        onDoubleClick={canDelete ? onDelete : undefined}
        sx={{
          maxWidth: "72%",
          bgcolor: isMine ? "primary.main" : "action.hover",
          color: isMine ? "primary.contrastText" : "text.primary",
          px: 1.5,
          py: 1,
          borderRadius: 3,
          borderBottomRightRadius: isMine ? 0.5 : 3,
          borderBottomLeftRadius: isMine ? 3 : 0.5,
        }}
      >
        {msg.attachments?.length > 0 &&
          msg.attachments.map((a, i) => (
            <Box key={i} sx={{ mb: 0.5 }}>
              {a.type === "image" ? (
                <Box
                  component="img"
                  src={a.url}
                  alt=""
                  sx={{ maxWidth: 240, borderRadius: 2, display: "block" }}
                />
              ) : a.type === "video" ? (
                <Box component="video" src={a.url} controls sx={{ maxWidth: 240, borderRadius: 2 }} />
              ) : (
                <Typography
                  component="a"
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  variant="body2"
                  sx={{ color: "inherit", textDecoration: "underline" }}
                >
                  📎 {a.name || "Tệp"}
                </Typography>
              )}
            </Box>
          ))}
        {!!msg.content && (
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {msg.deletedAt ? "(tin nhắn đã xoá)" : msg.content}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function ChatPanel({ conversationId, me }) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const { data: convo } = useListConversationsQuery({});
  const conv = useMemo(
    () => (convo?.items || []).find((c) => String(c._id) === String(conversationId)),
    [convo, conversationId]
  );
  const { data: msgs, isFetching, refetch } = useListMessagesQuery(
    conversationId ? { cid: conversationId } : { skip: true },
    { skip: !conversationId }
  );
  const [sendMessage, { isLoading: sending }] = useSendMessageMutation();
  const [markRead] = useMarkReadMutation();
  const [uploadMedia] = useUploadChatMediaMutation();
  const [deleteMessage] = useDeleteMessageMutation();

  useEffect(() => {
    if (conversationId) markRead(conversationId);
  }, [conversationId, markRead]);

  useEffect(() => {
    // Poll làm realtime tạm (socket refactor sau)
    const iv = setInterval(() => refetch(), 4000);
    return () => clearInterval(iv);
  }, [refetch]);

  // Scroll xuống cuối (newest) sau khi list update. Vì list trả về DESC,
  // ta reverse trước khi render.
  const items = useMemo(
    () => (msgs?.items || []).slice().reverse(),
    [msgs?.items]
  );
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [items.length]);

  const handlePickFiles = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 10);
    if (!files.length) return;
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    try {
      const r = await uploadMedia(fd).unwrap();
      setAttachments((p) => [...p, ...(r.attachments || [])].slice(0, 10));
    } catch (err) {
      toast.error(err?.data?.message || "Upload thất bại");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!text.trim() && !attachments.length) return;
    try {
      await sendMessage({
        cid: conversationId,
        content: text.trim(),
        attachments,
      }).unwrap();
      setText("");
      setAttachments([]);
    } catch (err) {
      toast.error(err?.data?.message || "Gửi thất bại");
    }
  };

  const handleDelete = async (mid) => {
    if (!window.confirm("Xoá tin nhắn?")) return;
    try {
      await deleteMessage(mid).unwrap();
      refetch();
    } catch (err) {
      toast.error(err?.data?.message || "Xoá thất bại");
    }
  };

  if (!conversationId) {
    return (
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.secondary",
        }}
      >
        <Typography>Chọn một hội thoại để bắt đầu.</Typography>
      </Box>
    );
  }

  const other = conv?.otherParticipants?.[0];
  const title =
    conv?.type === "tournament"
      ? `BTC · ${conv.tournament?.name || "Giải đấu"}`
      : authorName(other);

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" fontWeight={700}>
          {title}
        </Typography>
      </Box>
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflowY: "auto",
          px: 2,
          py: 1.5,
          bgcolor: "background.default",
        }}
      >
        {isFetching && !items.length && <CircularProgress size={20} />}
        {items.map((m) => {
          const isMine = String(m.sender?._id) === String(me?._id);
          const canDelete = isMine || me?.role === "admin";
          return (
            <MessageBubble
              key={m._id}
              msg={m}
              isMine={isMine}
              onDelete={() => handleDelete(m._id)}
              canDelete={canDelete}
            />
          );
        })}
      </Box>
      <Box sx={{ borderTop: 1, borderColor: "divider", p: 1.5 }}>
        {attachments.length > 0 && (
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
            {attachments.map((a, i) => (
              <Box
                key={i}
                sx={{
                  position: "relative",
                  width: 60,
                  height: 60,
                  borderRadius: 1,
                  overflow: "hidden",
                  bgcolor: "action.hover",
                }}
              >
                {a.type === "image" ? (
                  <img
                    src={a.url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <Box
                    sx={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: "grey.900",
                      color: "white",
                    }}
                  >
                    {a.type === "video" ? "🎬" : "📎"}
                  </Box>
                )}
                <IconButton
                  size="small"
                  onClick={() =>
                    setAttachments((p) => p.filter((_, j) => j !== i))
                  }
                  sx={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bgcolor: "rgba(0,0,0,.6)",
                    color: "#fff",
                    p: 0.5,
                    "&:hover": { bgcolor: "rgba(0,0,0,.8)" },
                  }}
                >
                  <Trash2 size={12} />
                </IconButton>
              </Box>
            ))}
          </Stack>
        )}
        <Stack direction="row" spacing={1} alignItems="center">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,application/pdf"
            multiple
            hidden
            onChange={handlePickFiles}
          />
          <IconButton onClick={() => fileRef.current?.click()}>📎</IconButton>
          <TextField
            fullWidth
            size="small"
            placeholder="Nhập tin nhắn…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            multiline
            maxRows={5}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <IconButton
            color="primary"
            onClick={submit}
            disabled={sending || (!text.trim() && !attachments.length)}
          >
            <Send size={18} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}

export default function MessagesPage() {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cid = searchParams.get("c");
  const { data, isFetching } = useListConversationsQuery({});

  if (!me) {
    return (
      <Box sx={{ maxWidth: 480, mx: "auto", p: 4, textAlign: "center" }}>
        <Typography variant="h5" gutterBottom>
          Nhắn tin
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Đăng nhập để nhắn tin với người dùng khác và BTC giải đấu.
        </Typography>
        <Button variant="contained" onClick={() => navigate("/login")}>
          Đăng nhập
        </Button>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        height: "calc(100vh - 80px)",
        maxWidth: 1280,
        mx: "auto",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        overflow: "hidden",
        mt: 2,
      }}
    >
      <SEOHead
        title="Nhắn tin | Pickletour"
        description="Trò chuyện với người dùng và BTC giải đấu."
      />
      <Box
        sx={{
          width: 320,
          borderRight: 1,
          borderColor: "divider",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="h6" fontWeight={800}>
            Nhắn tin
          </Typography>
        </Box>
        <Box sx={{ flex: 1, overflowY: "auto" }}>
          {isFetching && <CircularProgress size={20} sx={{ m: 2 }} />}
          {(data?.items || []).map((c) => (
            <>
              <ConversationRow
                key={c._id}
                conv={c}
                me={me}
                active={String(c._id) === String(cid)}
                onSelect={() => setSearchParams({ c: String(c._id) })}
              />
              <Divider />
            </>
          ))}
          {(data?.items || []).length === 0 && !isFetching && (
            <Box sx={{ p: 3, color: "text.secondary" }}>
              <Typography variant="body2">
                Chưa có hội thoại. Vào profile ai đó để nhắn.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      <ChatPanel conversationId={cid} me={me} />
    </Box>
  );
}
