// src/screens/NotificationSettingsPage.jsx — Cài đặt thông báo (web)
import { Link } from "react-router-dom";
import {
  Container,
  Box,
  Typography,
  Switch,
  Stack,
  Divider,
  Paper,
  IconButton,
  CircularProgress,
  ListItemButton,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import ChatIcon from "@mui/icons-material/Chat";
import ArticleIcon from "@mui/icons-material/Article";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import CloseIcon from "@mui/icons-material/Close";
import {
  useGetNotificationPrefsQuery,
  usePatchNotificationPrefsMutation,
} from "../slices/usersApiSlice";
import {
  useListMySubscriptionsQuery,
  useUnsubscribeTopicMutation,
} from "../slices/subscriptionApiSlice";
import { useGetTournamentQuery } from "../slices/tournamentsApiSlice";

function PrefRow({ icon, title, desc, checked, onChange, disabled }) {
  return (
    <Stack direction="row" alignItems="center" spacing={2} sx={{ py: 1.5 }}>
      <Box sx={{ color: "warning.main", display: "flex" }}>{icon}</Box>
      <Box sx={{ flex: 1 }}>
        <Typography fontWeight={700}>{title}</Typography>
        {desc && (
          <Typography variant="body2" color="text.secondary">
            {desc}
          </Typography>
        )}
      </Box>
      <Switch checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
    </Stack>
  );
}

function FollowedRow({ topicId, onUnfollow }) {
  const { data: t } = useGetTournamentQuery(topicId, { skip: !topicId });
  return (
    <Stack direction="row" alignItems="center" spacing={2} sx={{ py: 1 }}>
      <EmojiEventsIcon color="success" />
      <ListItemButton component={Link} to={`/tournament/${topicId}`} sx={{ flex: 1, borderRadius: 1, py: 0.5 }}>
        <Typography noWrap>{t?.name || "Giải đấu"}</Typography>
      </ListItemButton>
      <IconButton size="small" onClick={() => onUnfollow(topicId)} sx={{ color: "error.main" }}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

export default function NotificationSettingsPage() {
  const { data: prefs, isLoading } = useGetNotificationPrefsQuery();
  const [patch] = usePatchNotificationPrefsMutation();
  const { data: subs } = useListMySubscriptionsQuery();
  const [unsubscribe] = useUnsubscribeTopicMutation();

  const followed = (Array.isArray(subs) ? subs : []).filter(
    (s) => s.topicType === "tournament" && s.topicId
  );
  const pushEnabled = prefs?.pushEnabled !== false;
  const set = (body) => patch(body);

  return (
    <Container maxWidth="sm" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <NotificationsIcon color="warning" />
        <Typography variant="h5" fontWeight={800}>
          Cài đặt thông báo
        </Typography>
      </Stack>

      {isLoading ? (
        <Box textAlign="center" py={5}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Typography variant="overline" color="text.secondary">
            Chung
          </Typography>
          <Paper variant="outlined" sx={{ px: 2, borderRadius: 3, mb: 2 }}>
            <PrefRow
              icon={<NotificationsIcon />}
              title="Nhận thông báo đẩy"
              desc="Bật/tắt toàn bộ thông báo đẩy"
              checked={pushEnabled}
              onChange={(v) => set({ pushEnabled: v })}
            />
          </Paper>

          <Typography variant="overline" color="text.secondary">
            Theo loại
          </Typography>
          <Paper variant="outlined" sx={{ px: 2, borderRadius: 3, mb: 2 }}>
            <PrefRow
              icon={<ChatIcon />}
              title="Tin nhắn"
              desc="Thông báo tin nhắn trực tiếp và nhóm"
              checked={!prefs?.chatMuteAll}
              disabled={!pushEnabled}
              onChange={(v) => set({ chatMuteAll: !v })}
            />
            <Divider />
            <PrefRow
              icon={<ArticleIcon />}
              title="Bảng tin"
              desc="Bình luận, phản hồi, nhắc tên trong bài viết"
              checked={!prefs?.feedMuteAll}
              disabled={!pushEnabled}
              onChange={(v) => set({ feedMuteAll: !v })}
            />
            <Divider />
            <PrefRow
              icon={<EmojiEventsIcon />}
              title="Giải mới hợp trình"
              desc="Gợi ý giải đấu phù hợp trình độ của bạn"
              checked={!prefs?.tournamentMuteAll}
              disabled={!pushEnabled}
              onChange={(v) => set({ tournamentMuteAll: !v })}
            />
          </Paper>

          <Typography variant="overline" color="text.secondary">
            Giải đang theo dõi ({followed.length})
          </Typography>
          <Paper variant="outlined" sx={{ px: 2, py: followed.length ? 1 : 2, borderRadius: 3 }}>
            {followed.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Bạn chưa theo dõi giải nào. Mở trang giải và bấm "Theo dõi" để
                nhận thông báo lịch, kết quả.
              </Typography>
            ) : (
              followed.map((s) => (
                <FollowedRow
                  key={String(s.topicId)}
                  topicId={String(s.topicId)}
                  onUnfollow={(topicId) =>
                    unsubscribe({ topicType: "tournament", topicId })
                  }
                />
              ))
            )}
          </Paper>
        </>
      )}
    </Container>
  );
}
