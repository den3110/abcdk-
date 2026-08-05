// screens/MessagesPage.jsx — Nhắn tin (web) 2 pane: sidebar conversations + main chat.
import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Send,
  Trash2,
  Trophy,
  X as XIcon,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
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
  messagesApiSlice,
} from "../slices/messagesApiSlice.js";
import { socket } from "../lib/socket.js";
import MentionText from "../components/feed/MentionText.jsx";
import MentionAutocomplete from "../components/feed/MentionAutocomplete.jsx";
import TournamentPickerDialog from "../components/feed/TournamentPickerDialog.jsx";
import TournamentBubbleCard from "../components/feed/TournamentBubbleCard.jsx";
import { Chip } from "@mui/material";

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
          msg.deletedAt ? (
            <Typography variant="body2" sx={{ fontStyle: "italic", opacity: 0.7 }}>
              (tin nhắn đã xoá)
            </Typography>
          ) : (
            <MentionText
              content={msg.content}
              mentions={msg.mentions}
              sx={{ display: "block", fontSize: "0.875rem", color: "inherit" }}
            />
          )
        )}
        {msg.linkedTournament && (
          <TournamentBubbleCard
            tour={msg.linkedTournament}
            variant={isMine ? "chatMine" : "chat"}
          />
        )}
      </Box>
    </Box>
  );
}

function ChatPanel({ conversationId, me, onBack }) {
  const dispatch = useDispatch();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [linkedTournament, setLinkedTournament] = useState(null);
  const [tournamentPickerOpen, setTournamentPickerOpen] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState([]);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const submittingRef = useRef(false);
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

  // Socket realtime: subscribe room + listen chat:message:new & chat:message:deleted
  useEffect(() => {
    if (!conversationId) return;
    if (!socket.connected) {
      try {
        socket.connect();
      } catch {}
    }
    try {
      socket.emit("chat:subscribe", { conversationId: String(conversationId) });
    } catch {}

    const onNew = (payload) => {
      if (String(payload?.conversationId) !== String(conversationId)) return;
      const newMsg = payload?.message;
      if (!newMsg) return;
      dispatch(
        messagesApiSlice.util.updateQueryData(
          "listMessages",
          { cid: String(conversationId) },
          (draft) => {
            if (!draft?.items) return;
            if (
              draft.items.find((m) => String(m._id) === String(newMsg._id))
            )
              return;
            draft.items.unshift(newMsg);
          }
        )
      );
      // Mark read khi user đang mở conversation
      markRead(conversationId);
    };
    const onDeleted = (payload) => {
      if (String(payload?.conversationId) !== String(conversationId)) return;
      dispatch(
        messagesApiSlice.util.updateQueryData(
          "listMessages",
          { cid: String(conversationId) },
          (draft) => {
            if (!draft?.items) return;
            const idx = draft.items.findIndex(
              (m) => String(m._id) === String(payload.messageId)
            );
            if (idx >= 0)
              draft.items[idx].deletedAt = new Date().toISOString();
          }
        )
      );
    };
    socket.on("chat:message:new", onNew);
    socket.on("chat:message:deleted", onDeleted);
    return () => {
      try {
        socket.emit("chat:unsubscribe", {
          conversationId: String(conversationId),
        });
      } catch {}
      socket.off("chat:message:new", onNew);
      socket.off("chat:message:deleted", onDeleted);
    };
  }, [conversationId, dispatch, markRead]);

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
    if (submittingRef.current) return;
    if (!text.trim() && !attachments.length && !linkedTournament) return;
    submittingRef.current = true;
    const payloadText = text.trim();
    const payloadAttach = attachments;
    const payloadMentions = selectedMentions
      .filter((m) => text.includes(`@${m.display}`))
      .map((m) => m._id);
    const payloadTour = linkedTournament?._id || null;
    // Clear input NGAY để tránh double submit từ Enter thứ 2 gõ liền tay
    setText("");
    setAttachments([]);
    setLinkedTournament(null);
    setSelectedMentions([]);
    // Fallback: nếu IME onChange async fire sau Enter → clear lại
    setTimeout(() => setText(""), 30);
    try {
      await sendMessage({
        cid: conversationId,
        content: payloadText,
        attachments: payloadAttach,
        mentions: payloadMentions,
        linkedTournament: payloadTour,
      }).unwrap();
    } catch (err) {
      toast.error(err?.data?.message || "Gửi thất bại");
      // Restore text nếu gửi lỗi
      setText(payloadText);
      setAttachments(payloadAttach);
      setLinkedTournament(linkedTournament);
    } finally {
      submittingRef.current = false;
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

  // Auto-scroll xuống cuối khi có tin nhắn mới hoặc mở conversation
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items.length, conversationId]);

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}
      >
        {onBack && (
          <IconButton
            onClick={onBack}
            size="small"
            sx={{ display: { xs: "inline-flex", md: "none" } }}
          >
            <ChevronLeft size={20} />
          </IconButton>
        )}
        {other && (
          <Avatar src={other.avatar || ""} sx={{ width: 36, height: 36 }}>
            {authorName(other)[0]?.toUpperCase()}
          </Avatar>
        )}
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }} noWrap>
          {title}
        </Typography>
      </Stack>
      <Box
        ref={scrollRef}
        sx={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
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
        {linkedTournament && (
          <Chip
            icon={<Trophy size={14} />}
            label={linkedTournament.name}
            onDelete={() => setLinkedTournament(null)}
            deleteIcon={<XIcon size={14} />}
            sx={{
              alignSelf: "flex-start",
              mb: 1,
              bgcolor: "#FFF7ED",
              color: "#B45309",
              fontWeight: 600,
              border: 1,
              borderColor: "#FED7AA",
            }}
          />
        )}
        <Stack direction="row" spacing={1} alignItems="flex-end">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,application/pdf"
            multiple
            hidden
            onChange={handlePickFiles}
          />
          <IconButton onClick={() => fileRef.current?.click()}>📎</IconButton>
          <IconButton
            onClick={() => setTournamentPickerOpen(true)}
            sx={{ color: "#F59E0B" }}
            title="Gắn giải đấu"
          >
            <Trophy size={20} />
          </IconButton>
          <MentionAutocomplete
            value={text}
            onChange={setText}
            onPickMention={(u) =>
              setSelectedMentions((prev) =>
                prev.some((m) => m._id === String(u._id))
                  ? prev
                  : [
                      ...prev,
                      { _id: String(u._id), display: u.nickname || u.name },
                    ]
              )
            }
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              // IME safety: skip khi Vietnamese/CJK IME đang compose
              if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              submit();
            }}
            placeholder="Nhập tin nhắn… (Enter = gửi, Shift+Enter = xuống dòng, @ để nhắc)"
            multiline
            minRows={1}
            maxRows={5}
          />
          <IconButton
            color="primary"
            onClick={submit}
            disabled={
              sending ||
              (!text.trim() && !attachments.length && !linkedTournament)
            }
          >
            <Send size={18} />
          </IconButton>
        </Stack>
      </Box>
      <TournamentPickerDialog
        open={tournamentPickerOpen}
        onClose={() => setTournamentPickerOpen(false)}
        onPick={(t) => {
          setLinkedTournament(t);
          setTournamentPickerOpen(false);
        }}
      />
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
        // Mobile: fullscreen 100dvh (App.jsx đã hide site Header + MobileBottomNav
        // khi có ?c=xxx). Desktop: trừ site header + margin.
        height: {
          xs: cid ? "100dvh" : "calc(100dvh - 56px)",
          md: "calc(100dvh - 96px)",
        },
        maxWidth: 1280,
        width: "100%",
        mx: "auto",
        my: { xs: 0, md: 2 },
        border: { xs: 0, md: 1 },
        borderColor: "divider",
        borderRadius: { xs: 0, md: 2 },
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      <SEOHead
        title="Nhắn tin | Pickletour"
        description="Trò chuyện với người dùng và BTC giải đấu."
      />
      <Box
        sx={{
          width: { xs: "100%", md: 320 },
          borderRight: { xs: 0, md: 1 },
          borderColor: "divider",
          // Ẩn sidebar trên mobile khi đã chọn conversation, ưu tiên chat panel
          display: {
            xs: cid ? "none" : "flex",
            md: "flex",
          },
          flexDirection: "column",
          flexShrink: 0,
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
            <React.Fragment key={c._id}>
              <ConversationRow
                conv={c}
                me={me}
                active={String(c._id) === String(cid)}
                onSelect={() => setSearchParams({ c: String(c._id) })}
              />
              <Divider />
            </React.Fragment>
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
      {/* Chat panel — trên mobile chỉ hiện khi đã chọn conversation */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          display: {
            xs: cid ? "flex" : "none",
            md: "flex",
          },
          flexDirection: "column",
        }}
      >
        {cid ? (
          <ChatPanel conversationId={cid} me={me} onBack={() => setSearchParams({})} />
        ) : (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              color: "text.secondary",
              gap: 1,
            }}
          >
            <Typography variant="h6">Chọn một cuộc trò chuyện</Typography>
            <Typography variant="body2">
              Chọn hội thoại bên trái hoặc bắt đầu chat từ profile của người khác.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
