// Chat mini popup (~340×500) nổi ở góc phải dưới. Dùng lại logic của
// MessagesPage: mention autocomplete + gắn giải + socket realtime.
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch } from "react-redux";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import {
  Send,
  Trash2,
  Trophy,
  X as XIcon,
  ChevronRight,
  Maximize2,
  Minus,
} from "lucide-react";
import { toast } from "react-toastify";

import {
  useGetConversationQuery,
  useListMessagesQuery,
  useSendMessageMutation,
  useMarkReadMutation,
  useDeleteMessageMutation,
  useUploadChatMediaMutation,
  messagesApiSlice,
} from "../../slices/messagesApiSlice.js";
import MentionText from "../feed/MentionText.jsx";
import MentionAutocomplete from "../feed/MentionAutocomplete.jsx";
import TournamentPickerDialog from "../feed/TournamentPickerDialog.jsx";
import { socket } from "../../lib/socket.js";

const authorName = (u) => u?.nickname || u?.name || "Người dùng";

function Bubble({ msg, isMine, onDelete, canDelete }) {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isMine ? "flex-end" : "flex-start",
        mb: 0.5,
      }}
    >
      <Box
        onDoubleClick={canDelete ? onDelete : undefined}
        sx={{
          maxWidth: "78%",
          bgcolor: isMine ? "primary.main" : "action.hover",
          color: isMine ? "primary.contrastText" : "text.primary",
          px: 1.25,
          py: 0.75,
          borderRadius: 2.5,
          borderBottomRightRadius: isMine ? 0.5 : 2.5,
          borderBottomLeftRadius: isMine ? 2.5 : 0.5,
          fontSize: 14,
        }}
      >
        {(msg.attachments || []).map((a, i) => (
          <Box key={i} sx={{ mb: 0.5 }}>
            {a.type === "image" ? (
              <Box
                component="img"
                src={a.url}
                sx={{ maxWidth: 200, borderRadius: 1.5, display: "block" }}
              />
            ) : a.type === "video" ? (
              <Box
                component="video"
                src={a.url}
                controls
                sx={{ maxWidth: 200, borderRadius: 1.5 }}
              />
            ) : (
              <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>
                📎 {a.name || "Tệp"}
              </a>
            )}
          </Box>
        ))}
        {msg.content &&
          (msg.deletedAt ? (
            <Typography variant="caption" sx={{ fontStyle: "italic", opacity: 0.7 }}>
              (đã xoá)
            </Typography>
          ) : (
            <MentionText
              content={msg.content}
              mentions={msg.mentions}
              sx={{ fontSize: 14, color: "inherit" }}
            />
          ))}
        {msg.linkedTournament && (
          <Box
            component={RouterLink}
            to={`/tournament/${msg.linkedTournament._id}`}
            sx={{
              mt: 0.75,
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              p: 0.75,
              borderRadius: 1.5,
              bgcolor: isMine ? "rgba(255,255,255,0.15)" : "#FFFBEB",
              border: 1,
              borderColor: isMine ? "rgba(255,255,255,0.28)" : "#FDE68A",
              textDecoration: "none",
              color: "inherit",
              maxWidth: 220,
            }}
          >
            <Avatar
              src={msg.linkedTournament.image || ""}
              variant="rounded"
              sx={{
                width: 30,
                height: 30,
                bgcolor: "#FEF3C7",
              }}
            >
              <Trophy size={14} color="#F59E0B" />
            </Avatar>
            <Box flex={1} minWidth={0}>
              <Typography variant="caption" fontWeight={800} sx={{ display: "block", opacity: 0.85 }}>
                GIẢI ĐẤU
              </Typography>
              <Typography variant="caption" fontWeight={700} noWrap>
                {msg.linkedTournament.name}
              </Typography>
            </Box>
            <ChevronRight size={14} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function FloatingChatWindow({
  conversationId,
  me,
  onClose,
  offsetRight = 100,
}) {
  const [minimized, setMinimized] = useState(false);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [linkedTournament, setLinkedTournament] = useState(null);
  const [tournamentPickerOpen, setTournamentPickerOpen] = useState(false);
  const [selectedMentions, setSelectedMentions] = useState([]);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const submittingRef = useRef(false);

  const { data: conv } = useGetConversationQuery(conversationId, {
    skip: !conversationId,
  });
  const { data: msgs, isFetching } = useListMessagesQuery(
    { cid: conversationId },
    { skip: !conversationId }
  );
  const [sendMessage, { isLoading: sending }] = useSendMessageMutation();
  const [markRead] = useMarkReadMutation();
  const [uploadMedia] = useUploadChatMediaMutation();
  const [deleteMessage] = useDeleteMessageMutation();

  const items = useMemo(
    () => (msgs?.items || []).slice().reverse(),
    [msgs?.items]
  );
  const other = conv?.otherParticipants?.[0];
  const title =
    conv?.type === "tournament"
      ? `BTC · ${conv?.tournament?.name || "Giải đấu"}`
      : authorName(other);

  // markRead when open
  useEffect(() => {
    if (conversationId && !minimized) markRead(conversationId);
  }, [conversationId, markRead, minimized]);

  // socket subscribe
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
            if (draft.items.find((m) => String(m._id) === String(newMsg._id))) return;
            draft.items.unshift(newMsg);
          }
        )
      );
      if (!minimized) markRead(conversationId);
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
  }, [conversationId, dispatch, markRead, minimized]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items.length, minimized]);

  const handlePickFiles = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
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
    const payloadTour = linkedTournament?._id || null;
    const payloadMentions = selectedMentions
      .filter((m) => text.includes(`@${m.display}`))
      .map((m) => m._id);
    setText("");
    setAttachments([]);
    setLinkedTournament(null);
    setSelectedMentions([]);
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
    } catch (err) {
      toast.error(err?.data?.message || "Xoá thất bại");
    }
  };

  return (
    <Paper
      elevation={12}
      sx={{
        position: "fixed",
        bottom: 20,
        right: offsetRight,
        width: 340,
        height: minimized ? 48 : 500,
        display: "flex",
        flexDirection: "column",
        borderRadius: 3,
        borderBottomLeftRadius: minimized ? 3 : 0,
        borderBottomRightRadius: minimized ? 3 : 0,
        overflow: "hidden",
        zIndex: 1250,
        transition: "height .2s",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{
          px: 1.5,
          py: 1,
          borderBottom: minimized ? 0 : 1,
          borderColor: "divider",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          cursor: "pointer",
        }}
        onClick={() => setMinimized((v) => !v)}
      >
        <Avatar
          src={other?.avatar || ""}
          sx={{ width: 30, height: 30, fontSize: 13 }}
        >
          {title[0]?.toUpperCase()}
        </Avatar>
        <Typography variant="body2" fontWeight={700} sx={{ flex: 1 }} noWrap>
          {title}
        </Typography>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/messages?c=${conversationId}`);
          }}
          sx={{ color: "inherit" }}
          title="Mở fullscreen"
        >
          <Maximize2 size={14} />
        </IconButton>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setMinimized(true);
          }}
          sx={{ color: "inherit" }}
          title="Thu nhỏ"
        >
          <Minus size={14} />
        </IconButton>
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          sx={{ color: "inherit" }}
          title="Đóng"
        >
          <XIcon size={14} />
        </IconButton>
      </Stack>

      {!minimized && (
        <>
          <Box
            ref={scrollRef}
            sx={{
              flex: 1,
              overflowY: "auto",
              minHeight: 0,
              px: 1.5,
              py: 1,
              bgcolor: "background.default",
            }}
          >
            {isFetching && !items.length && (
              <Box textAlign="center" py={2}>
                <CircularProgress size={20} />
              </Box>
            )}
            {items.map((m) => {
              const isMine = String(m.sender?._id) === String(me?._id);
              const canDelete = isMine || me?.role === "admin";
              return (
                <Bubble
                  key={m._id}
                  msg={m}
                  isMine={isMine}
                  onDelete={() => handleDelete(m._id)}
                  canDelete={canDelete}
                />
              );
            })}
            {!isFetching && items.length === 0 && (
              <Typography
                variant="caption"
                sx={{ display: "block", textAlign: "center", color: "text.secondary", py: 2 }}
              >
                Chưa có tin nhắn. Nói xin chào 👋
              </Typography>
            )}
          </Box>

          <Box sx={{ borderTop: 1, borderColor: "divider", p: 1 }}>
            {attachments.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap", gap: 0.5 }}>
                {attachments.map((a, i) => (
                  <Box
                    key={i}
                    sx={{
                      position: "relative",
                      width: 48,
                      height: 48,
                      borderRadius: 1,
                      overflow: "hidden",
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
                          bgcolor: "action.hover",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 20,
                        }}
                      >
                        📎
                      </Box>
                    )}
                    <IconButton
                      size="small"
                      onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))}
                      sx={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        p: 0.25,
                        bgcolor: "rgba(0,0,0,.6)",
                        color: "#fff",
                        "&:hover": { bgcolor: "rgba(0,0,0,.8)" },
                      }}
                    >
                      <Trash2 size={10} />
                    </IconButton>
                  </Box>
                ))}
              </Stack>
            )}
            {linkedTournament && (
              <Chip
                icon={<Trophy size={12} />}
                label={linkedTournament.name}
                onDelete={() => setLinkedTournament(null)}
                deleteIcon={<XIcon size={12} />}
                size="small"
                sx={{
                  mb: 0.75,
                  bgcolor: "#FFF7ED",
                  color: "#B45309",
                  fontWeight: 600,
                  border: 1,
                  borderColor: "#FED7AA",
                  maxWidth: "100%",
                }}
              />
            )}
            <Stack direction="row" spacing={0.5} alignItems="flex-end">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,application/pdf"
                multiple
                hidden
                onChange={handlePickFiles}
              />
              <IconButton size="small" onClick={() => fileRef.current?.click()}>
                📎
              </IconButton>
              <IconButton
                size="small"
                onClick={() => setTournamentPickerOpen(true)}
                sx={{ color: "#F59E0B" }}
                title="Gắn giải"
              >
                <Trophy size={16} />
              </IconButton>
              <Box flex={1}>
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
                    if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    submit();
                  }}
                  placeholder="Aa (Enter = gửi, Shift+Enter = xuống dòng)"
                  multiline
                  minRows={1}
                  maxRows={4}
                />
              </Box>
              <IconButton
                color="primary"
                size="small"
                onClick={submit}
                disabled={
                  sending ||
                  (!text.trim() && !attachments.length && !linkedTournament)
                }
              >
                <Send size={16} />
              </IconButton>
            </Stack>
          </Box>
        </>
      )}
      <TournamentPickerDialog
        open={tournamentPickerOpen}
        onClose={() => setTournamentPickerOpen(false)}
        onPick={(t) => {
          setLinkedTournament(t);
          setTournamentPickerOpen(false);
        }}
      />
    </Paper>
  );
}
