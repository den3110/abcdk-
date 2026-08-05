// screens/NotificationsPage.jsx — Trung tâm thông báo (web)
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { Bell, Check, Trash2 } from "lucide-react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

import SEOHead from "../components/SEOHead.jsx";
import {
  useDeleteNotifMutation,
  useListNotifsQuery,
  useMarkAllNotifReadMutation,
  useMarkNotifReadMutation,
} from "../slices/notificationCenterApiSlice.js";
import { normalizeNotifUrl } from "../utils/notifUrl.js";

const fmt = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ`;
  return d.toLocaleDateString("vi-VN");
};
const authorName = (u) => u?.nickname || u?.name || "Người dùng";

export default function NotificationsPage() {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const { data, isFetching, refetch } = useListNotifsQuery({});
  const [markRead] = useMarkNotifReadMutation();
  const [markAllRead] = useMarkAllNotifReadMutation();
  const [deleteNotif] = useDeleteNotifMutation();

  if (!me) {
    return (
      <Box sx={{ maxWidth: 480, mx: "auto", p: 4, textAlign: "center" }}>
        <Typography variant="h5" gutterBottom>
          Thông báo
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Đăng nhập để xem thông báo.
        </Typography>
        <Button variant="contained" onClick={() => navigate("/login")}>
          Đăng nhập
        </Button>
      </Box>
    );
  }

  const items = data?.items || [];
  const unread = items.filter((x) => !x.isRead).length;

  const handleOpen = async (n) => {
    if (!n.isRead) {
      try {
        await markRead(n._id).unwrap();
      } catch {}
    }
    if (n.url) navigate(normalizeNotifUrl(n.url));
  };

  return (
    <Box sx={{ maxWidth: 720, mx: "auto", p: 2 }}>
      <SEOHead title="Thông báo | Pickletour" />
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Typography variant="h5" fontWeight={800}>
          Thông báo
        </Typography>
        {unread > 0 && (
          <Button
            size="small"
            startIcon={<Check size={16} />}
            onClick={() => markAllRead()}
            sx={{ textTransform: "none" }}
          >
            Đã đọc tất cả
          </Button>
        )}
      </Stack>
      <Box
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          bgcolor: "background.paper",
        }}
      >
        {isFetching && !items.length && (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <CircularProgress size={20} />
          </Box>
        )}
        {items.length === 0 && !isFetching && (
          <Box
            sx={{
              p: 6,
              textAlign: "center",
              color: "text.secondary",
            }}
          >
            <Bell size={48} />
            <Typography sx={{ mt: 1 }}>Chưa có thông báo nào.</Typography>
          </Box>
        )}
        {items.map((n, i) => (
          <Box key={n._id}>
            <Stack
              direction="row"
              alignItems="flex-start"
              spacing={1.5}
              sx={{
                px: 2,
                py: 1.5,
                bgcolor: n.isRead ? "transparent" : "action.hover",
                cursor: "pointer",
                "&:hover": { bgcolor: "action.selected" },
              }}
              onClick={() => handleOpen(n)}
            >
              <Avatar src={n.actor?.avatar || ""} sx={{ width: 40, height: 40 }}>
                {authorName(n.actor)[0]?.toUpperCase()}
              </Avatar>
              <Box flex={1} minWidth={0}>
                <Typography
                  variant="body2"
                  fontWeight={n.isRead ? 500 : 800}
                  sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
                >
                  {(() => {
                    const actorLabel = n.actor ? authorName(n.actor) : "";
                    const title = n.title || "";
                    // Bỏ prefix "actor · " nếu title đã trùng tên actor (VD chat: title = tên actor)
                    if (actorLabel && title && title === actorLabel) return title;
                    if (actorLabel && title) return `${actorLabel} · ${title}`;
                    return actorLabel || title || "Thông báo";
                  })()}
                  {n.count > 1 && (
                    <Box
                      component="span"
                      sx={{
                        px: 0.75,
                        py: 0.1,
                        borderRadius: 999,
                        bgcolor: "primary.main",
                        color: "primary.contrastText",
                        fontSize: 11,
                        fontWeight: 800,
                        lineHeight: 1.4,
                      }}
                    >
                      {n.count > 99 ? "99+" : n.count}
                    </Box>
                  )}
                  {!n.isRead && (
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "error.main",
                      }}
                    />
                  )}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {n.body}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {fmt(n.createdAt)}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteNotif(n._id);
                }}
              >
                <Trash2 size={14} />
              </IconButton>
            </Stack>
            {i < items.length - 1 && <Divider />}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
