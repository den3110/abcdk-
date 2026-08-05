// MUI version của NotificationBell — dùng trong Header.jsx (main header).
// Realtime qua socket "notification:new".
import { useCallback, useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Badge,
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import DoneAllIcon from "@mui/icons-material/DoneAll";

import {
  useListNotifsQuery,
  useNotifUnreadCountQuery,
  useMarkNotifReadMutation,
  useMarkAllNotifReadMutation,
  notificationCenterApiSlice,
} from "../slices/notificationCenterApiSlice.js";
import { socket } from "../lib/socket.js";
import { normalizeNotifUrl } from "../utils/notifUrl.js";

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

export default function NotificationBellMui() {
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);
  const userInfo = useSelector((s) => s.auth?.userInfo);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { data: unreadData, refetch: refetchCount } = useNotifUnreadCountQuery(
    undefined,
    { skip: !userInfo, pollingInterval: 60000 }
  );
  const { data, refetch, isLoading } = useListNotifsQuery(
    { limit: 8 },
    { skip: !userInfo || !open }
  );
  const [markRead] = useMarkNotifReadMutation();
  const [markAllRead] = useMarkAllNotifReadMutation();

  const unreadCount = Number(unreadData?.count || 0);

  useEffect(() => {
    if (!userInfo?._id) return;
    if (!socket.connected) {
      try {
        socket.connect();
      } catch {}
    }
    const onNew = (payload) => {
      // Backend gửi `isNewUnread=false` khi chỉ upsert notif đang unread sẵn
      // (VD tin nhắn tiếp theo cùng cuộc hội thoại) — count tổng KHÔNG tăng.
      const isNewUnread = payload?.isNewUnread !== false;
      if (isNewUnread) {
        dispatch(
          notificationCenterApiSlice.util.updateQueryData(
            "notifUnreadCount",
            undefined,
            (draft) => {
              if (draft) draft.count = (draft.count || 0) + 1;
              else return { count: 1 };
            }
          )
        );
      }
      dispatch(
        notificationCenterApiSlice.util.updateQueryData(
          "listNotifs",
          { limit: 8 },
          (draft) => {
            if (!draft?.items) return;
            const idx = draft.items.findIndex(
              (i) => String(i._id) === String(payload?._id)
            );
            if (idx >= 0) draft.items.splice(idx, 1); // remove old position
            draft.items.unshift(payload);
            draft.items = draft.items.slice(0, 8);
          }
        )
      );
    };
    socket.on("notification:new", onNew);
    return () => socket.off("notification:new", onNew);
  }, [userInfo?._id, dispatch]);

  const handleClickItem = useCallback(
    async (n) => {
      setAnchor(null);
      if (!n.isRead) {
        try {
          await markRead(n._id).unwrap();
        } catch {}
        refetchCount();
      }
      if (n.url) navigate(normalizeNotifUrl(n.url));
      else navigate("/notifications");
    },
    [markRead, navigate, refetchCount]
  );

  const handleMarkAllRead = async () => {
    try {
      await markAllRead().unwrap();
      refetch();
      refetchCount();
    } catch {}
  };

  if (!userInfo) return null;
  const items = data?.items || [];

  return (
    <>
      <IconButton
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={
          unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : "Thông báo"
        }
        size="medium"
        sx={{ color: "text.primary" }}
      >
        <Badge
          badgeContent={unreadCount > 99 ? "99+" : unreadCount}
          color="error"
          overlap="circular"
          invisible={unreadCount === 0}
          sx={{
            "& .MuiBadge-badge": {
              fontSize: 10,
              minWidth: 18,
              height: 18,
              fontWeight: 700,
            },
          }}
        >
          <NotificationsNoneIcon />
        </Badge>
      </IconButton>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            width: 380,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: 480,
            display: "flex",
            flexDirection: "column",
            borderRadius: 2,
            mt: 1,
            overflow: "hidden",
          },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}
        >
          <Typography variant="subtitle1" fontWeight={800}>
            Thông báo
          </Typography>
          {unreadCount > 0 && (
            <IconButton
              size="small"
              onClick={handleMarkAllRead}
              title="Đánh dấu đã đọc tất cả"
              sx={{ color: "primary.main" }}
            >
              <DoneAllIcon fontSize="small" />
            </IconButton>
          )}
        </Stack>

        <Box sx={{ flex: 1, overflowY: "auto" }}>
          {isLoading && (
            <Stack spacing={1} sx={{ p: 1.5 }}>
              {[...Array(3)].map((_, i) => (
                <Stack key={i} direction="row" spacing={1.5}>
                  <Skeleton variant="circular" width={40} height={40} />
                  <Box flex={1}>
                    <Skeleton width="70%" />
                    <Skeleton width="40%" />
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
          {!isLoading && items.length === 0 && (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                Chưa có thông báo nào
              </Typography>
            </Box>
          )}
          <List disablePadding>
            {items.map((n) => (
              <ListItemButton
                key={n._id}
                onClick={() => handleClickItem(n)}
                sx={{
                  alignItems: "flex-start",
                  py: 1.25,
                  gap: 1.25,
                  bgcolor: n.isRead
                    ? "transparent"
                    : (t) =>
                        t.palette.mode === "dark"
                          ? "rgba(69,153,255,0.10)"
                          : "rgba(24,119,242,0.06)",
                  borderBottom: 1,
                  borderColor: "divider",
                }}
              >
                <Avatar
                  src={n.actor?.avatar || ""}
                  sx={{ width: 40, height: 40 }}
                >
                  {(
                    n.actor?.nickname ||
                    n.actor?.name ||
                    n.title ||
                    "?"
                  )[0]?.toUpperCase()}
                </Avatar>
                <Box flex={1} minWidth={0}>
                  <Typography
                    variant="body2"
                    fontWeight={n.isRead ? 500 : 700}
                    sx={{
                      lineHeight: 1.35,
                      display: "flex",
                      alignItems: "center",
                      gap: 0.75,
                    }}
                  >
                    <Box component="span" sx={{ minWidth: 0, flex: "0 1 auto" }}>
                      {n.title || "Thông báo"}
                    </Box>
                    {n.count > 1 && (
                      <Box
                        component="span"
                        sx={{
                          px: 0.75,
                          py: 0.05,
                          borderRadius: 999,
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                          fontSize: 10,
                          fontWeight: 800,
                          lineHeight: 1.5,
                          flexShrink: 0,
                        }}
                      >
                        {n.count > 99 ? "99+" : n.count}
                      </Box>
                    )}
                  </Typography>
                  {n.body && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        mt: 0.25,
                      }}
                    >
                      {n.body}
                    </Typography>
                  )}
                  <Typography
                    variant="caption"
                    sx={{
                      color: n.isRead ? "text.secondary" : "primary.main",
                      fontWeight: 600,
                      display: "block",
                      mt: 0.5,
                    }}
                  >
                    {fmtTime(n.createdAt)}
                  </Typography>
                </Box>
                {!n.isRead && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: "primary.main",
                      mt: 1,
                      flexShrink: 0,
                    }}
                  />
                )}
              </ListItemButton>
            ))}
          </List>
        </Box>

        <Divider />
        <ListItemButton
          onClick={() => {
            setAnchor(null);
            navigate("/notifications");
          }}
          sx={{
            justifyContent: "center",
            py: 1.25,
            color: "primary.main",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Xem tất cả thông báo
        </ListItemButton>
      </Popover>
    </>
  );
}
