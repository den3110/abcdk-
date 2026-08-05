// Facebook Messenger-style floating chat widget.
// - Bubble góc phải dưới với badge unread
// - Bấm bubble → mở panel danh sách hội thoại (giống Messenger)
// - Chọn conv → mở chat window nổi bên trái panel (multi-window OK trên desktop)
// - Mobile: chọn conv → navigate /messages?c=xxx (fullscreen)
import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Badge,
  Box,
  IconButton,
  Paper,
  Stack,
  Typography,
  useMediaQuery,
} from "@mui/material";
import { X, MessageSquare, Edit3 } from "lucide-react";

import { useListConversationsQuery, messagesApiSlice } from "../../slices/messagesApiSlice.js";
import { socket } from "../../lib/socket.js";
import FloatingChatWindow from "./FloatingChatWindow.jsx";

const authorName = (u) => u?.nickname || u?.name || "Người dùng";
const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)}p`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}n`;
  return d.toLocaleDateString("vi-VN");
};

function ConvRow({ conv, me, onOpen }) {
  const other = conv.otherParticipants?.[0];
  const title =
    conv.type === "tournament"
      ? `BTC · ${conv.tournament?.name || "Giải đấu"}`
      : authorName(other);
  const preview =
    conv.lastMessage?.text ||
    (conv.lastMessage?.hasAttachment ? "📎 Đính kèm" : "Chưa có tin nhắn");
  const isSelf =
    conv.lastMessage?.sender &&
    String(conv.lastMessage.sender) === String(me?._id);
  const unread = Number(conv.unread || 0);

  return (
    <Box
      onClick={onOpen}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 1.5,
        py: 1.25,
        cursor: "pointer",
        borderRadius: 2,
        mx: 0.5,
        "&:hover": { bgcolor: "action.hover" },
      }}
    >
      <Avatar
        src={other?.avatar || ""}
        sx={{
          width: 48,
          height: 48,
          bgcolor: conv.type === "tournament" ? "#F59E0B" : "primary.main",
        }}
      >
        {title[0]?.toUpperCase() || "?"}
      </Avatar>
      <Box flex={1} minWidth={0}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography
            variant="body2"
            fontWeight={unread > 0 ? 800 : 600}
            noWrap
            sx={{ flex: 1 }}
          >
            {title}
          </Typography>
          <Typography variant="caption" color="text.secondary" flexShrink={0}>
            {fmtTime(conv.lastMessageAt)}
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.25 }}>
          <Typography
            variant="caption"
            color={unread > 0 ? "text.primary" : "text.secondary"}
            fontWeight={unread > 0 ? 600 : 400}
            noWrap
            sx={{ flex: 1 }}
          >
            {isSelf ? "Bạn: " : ""}
            {preview}
          </Typography>
          {unread > 0 && (
            <Box
              sx={{
                bgcolor: "primary.main",
                color: "#fff",
                fontSize: 10,
                fontWeight: 800,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                px: 0.5,
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
              }}
            >
              {unread > 99 ? "99+" : unread}
            </Box>
          )}
        </Stack>
      </Box>
    </Box>
  );
}

export default function MessengerLauncher() {
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width:900px)");

  const [panelOpen, setPanelOpen] = useState(false);
  // Danh sách conversation đang mở (chat windows). Mobile chỉ 1.
  const [openConvIds, setOpenConvIds] = useState([]);

  const { data, isFetching } = useListConversationsQuery(
    {},
    { skip: !userInfo, pollingInterval: 30000 }
  );

  const items = data?.items || [];
  const totalUnread = useMemo(
    () => items.reduce((s, c) => s + Number(c.unread || 0), 0),
    [items]
  );

  // Auto-connect socket + listen chat:message:new để bump preview + unread
  useEffect(() => {
    if (!userInfo?._id) return;
    if (!socket.connected) {
      try {
        socket.connect();
      } catch {}
    }
    const onNew = (payload) => {
      const cid = String(payload?.conversationId || "");
      const msg = payload?.message;
      if (!cid || !msg) return;
      // Nếu conversation này đang mở trong 1 chat window, bỏ qua (window tự patch)
      dispatch(
        messagesApiSlice.util.updateQueryData(
          "listConversations",
          {},
          (draft) => {
            if (!draft?.items) return;
            const idx = draft.items.findIndex(
              (c) => String(c._id) === cid
            );
            if (idx < 0) return;
            const conv = draft.items[idx];
            conv.lastMessage = {
              text: msg.content || (msg.attachments?.length ? "[Đính kèm]" : ""),
              sender: msg.sender?._id || msg.sender,
              at: msg.createdAt,
              hasAttachment: (msg.attachments || []).length > 0,
            };
            conv.lastMessageAt = msg.createdAt;
            const senderId = String(msg.sender?._id || msg.sender || "");
            const isMine = senderId === String(userInfo._id);
            // Nếu không phải mình gửi VÀ conv chưa mở → tăng unread
            if (!isMine && !openConvIds.includes(cid)) {
              conv.unread = Number(conv.unread || 0) + 1;
            }
            // Bump lên đầu
            draft.items.splice(idx, 1);
            draft.items.unshift(conv);
          }
        )
      );
    };
    socket.on("chat:message:new", onNew);
    return () => socket.off("chat:message:new", onNew);
  }, [userInfo?._id, dispatch, openConvIds]);

  if (!userInfo) return null;

  const openConv = (cid) => {
    setPanelOpen(false);
    if (isMobile) {
      navigate(`/messages?c=${cid}`);
      return;
    }
    setOpenConvIds((prev) => {
      if (prev.includes(cid)) return prev;
      // Max 3 windows đồng thời trên desktop, kick oldest
      const next = [cid, ...prev].slice(0, 3);
      return next;
    });
  };

  const closeConv = (cid) => {
    setOpenConvIds((prev) => prev.filter((x) => x !== cid));
  };

  return (
    <>
      {/* Floating chat windows (desktop only, mobile fullscreen) */}
      {!isMobile &&
        openConvIds.map((cid, idx) => (
          <FloatingChatWindow
            key={cid}
            conversationId={cid}
            me={userInfo}
            onClose={() => closeConv(cid)}
            offsetRight={100 + idx * 340}
          />
        ))}

      {/* Panel danh sách conversation */}
      {panelOpen && (
        <>
          <Box
            onClick={() => setPanelOpen(false)}
            sx={{ position: "fixed", inset: 0, zIndex: 1298 }}
          />
          <Paper
            elevation={12}
            sx={{
              position: "fixed",
              bottom: 88,
              right: 20,
              width: { xs: "calc(100vw - 32px)", sm: 380 },
              maxWidth: 380,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              borderRadius: 3,
              overflow: "hidden",
              zIndex: 1299,
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}
            >
              <Typography variant="h6" fontWeight={800}>
                Nhắn tin
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setPanelOpen(false);
                    navigate("/messages");
                  }}
                  title="Mở trang nhắn tin"
                >
                  <Edit3 size={18} />
                </IconButton>
                <IconButton size="small" onClick={() => setPanelOpen(false)}>
                  <X size={18} />
                </IconButton>
              </Stack>
            </Stack>
            <Box sx={{ flex: 1, overflowY: "auto", py: 0.5 }}>
              {isFetching && !items.length && (
                <Typography sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
                  Đang tải…
                </Typography>
              )}
              {!isFetching && items.length === 0 && (
                <Typography sx={{ p: 3, textAlign: "center", color: "text.secondary", fontSize: 13 }}>
                  Chưa có hội thoại. Vào profile ai đó để nhắn.
                </Typography>
              )}
              {items.map((c) => (
                <ConvRow
                  key={c._id}
                  conv={c}
                  me={userInfo}
                  onOpen={() => openConv(String(c._id))}
                />
              ))}
            </Box>
          </Paper>
        </>
      )}

      {/* Floating bubble launcher */}
      <IconButton
        onClick={() => setPanelOpen((v) => !v)}
        aria-label={
          totalUnread > 0 ? `${totalUnread} tin nhắn chưa đọc` : "Nhắn tin"
        }
        sx={{
          position: "fixed",
          bottom: { xs: 74, sm: 20 }, // trên mobile nhích lên tránh MobileBottomNav
          right: 20,
          width: 56,
          height: 56,
          bgcolor: "primary.main",
          color: "#fff",
          boxShadow: 6,
          zIndex: 1300,
          "&:hover": { bgcolor: "primary.dark" },
        }}
      >
        <Badge
          badgeContent={totalUnread > 99 ? "99+" : totalUnread}
          color="error"
          overlap="circular"
          invisible={totalUnread === 0}
          sx={{
            "& .MuiBadge-badge": {
              fontSize: 10,
              minWidth: 18,
              height: 18,
              fontWeight: 800,
              border: "2px solid",
              borderColor: "primary.main",
            },
          }}
        >
          <MessageSquare size={26} strokeWidth={2.2} />
        </Badge>
      </IconButton>
    </>
  );
}
