// screens/FriendsPage.jsx — Trang Bạn bè (3 tab: bạn bè / lời mời đến / đã gửi)
import { useState } from "react";
import {
  Avatar,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";

import SEOHead from "../components/SEOHead.jsx";
import FriendActions from "../components/FriendActions.jsx";
import OpenMessageButton from "../components/OpenMessageButton.jsx";
import {
  useFriendCountsQuery,
  useListFriendRequestsQuery,
  useListFriendsQuery,
} from "../slices/friendsApiSlice.js";

const authorName = (u) => u?.nickname || u?.name || "Người dùng";
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString("vi-VN") : "");

function UserRow({ user, right, meta }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={2}
      sx={{ px: 2, py: 1.5, "&:hover": { bgcolor: "action.hover" } }}
    >
      <Avatar
        src={user?.avatar || ""}
        component="a"
        href={user?._id ? `/user/${user._id}` : undefined}
        sx={{ cursor: user?._id ? "pointer" : "default" }}
      >
        {authorName(user)[0]?.toUpperCase()}
      </Avatar>
      <Box flex={1} minWidth={0}>
        <Typography
          variant="subtitle2"
          fontWeight={700}
          component="a"
          href={user?._id ? `/user/${user._id}` : undefined}
          sx={{ color: "text.primary", textDecoration: "none" }}
        >
          {authorName(user)}
        </Typography>
        {meta && (
          <Typography variant="caption" color="text.secondary" display="block">
            {meta}
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1}>
        {right}
      </Stack>
    </Stack>
  );
}

function FriendsTab() {
  const { data, isFetching } = useListFriendsQuery({});
  const items = data?.items || [];
  if (isFetching && !items.length) return <CircularProgress size={20} />;
  if (!items.length)
    return (
      <Box sx={{ p: 3, color: "text.secondary", textAlign: "center" }}>
        Bạn chưa có người bạn nào. Hãy gửi lời mời từ Bảng xếp hạng hoặc trang cá
        nhân.
      </Box>
    );
  return (
    <Stack divider={<Divider />}>
      {items.map((it) => (
        <UserRow
          key={it.edgeId}
          user={it.user}
          meta={`Bạn từ ${fmt(it.since)}`}
          right={
            <>
              <OpenMessageButton userId={it.user?._id} compact={false} />
              <FriendActions userId={it.user?._id} />
            </>
          }
        />
      ))}
    </Stack>
  );
}

function IncomingTab() {
  const { data, isFetching } = useListFriendRequestsQuery("incoming");
  const items = data?.items || [];
  if (isFetching && !items.length) return <CircularProgress size={20} />;
  if (!items.length)
    return (
      <Box sx={{ p: 3, color: "text.secondary", textAlign: "center" }}>
        Không có lời mời nào đang chờ.
      </Box>
    );
  return (
    <Stack divider={<Divider />}>
      {items.map((it) => (
        <UserRow
          key={it.edgeId}
          user={it.user}
          meta={`Gửi lời mời ${fmt(it.at)}`}
          right={<FriendActions userId={it.user?._id} />}
        />
      ))}
    </Stack>
  );
}

function OutgoingTab() {
  const { data, isFetching } = useListFriendRequestsQuery("outgoing");
  const items = data?.items || [];
  if (isFetching && !items.length) return <CircularProgress size={20} />;
  if (!items.length)
    return (
      <Box sx={{ p: 3, color: "text.secondary", textAlign: "center" }}>
        Bạn chưa gửi lời mời kết bạn nào đang chờ.
      </Box>
    );
  return (
    <Stack divider={<Divider />}>
      {items.map((it) => (
        <UserRow
          key={it.edgeId}
          user={it.user}
          meta={`Đã gửi ${fmt(it.at)}`}
          right={<FriendActions userId={it.user?._id} />}
        />
      ))}
    </Stack>
  );
}

export default function FriendsPage() {
  const me = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const [tab, setTab] = useState(0);
  const { data: counts } = useFriendCountsQuery(undefined, { skip: !me });

  if (!me) {
    return (
      <Box sx={{ maxWidth: 480, mx: "auto", p: 4, textAlign: "center" }}>
        <Typography variant="h5" gutterBottom>
          Bạn bè
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          Đăng nhập để xem bạn bè và lời mời.
        </Typography>
        <Button variant="contained" onClick={() => navigate("/login")}>
          Đăng nhập
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: "auto", p: 2 }}>
      <SEOHead
        title="Bạn bè | Pickletour"
        description="Quản lý danh sách bạn bè và lời mời kết bạn."
      />
      <Typography variant="h5" fontWeight={800} sx={{ mb: 2 }}>
        Bạn bè
      </Typography>
      <Tabs
        value={tab}
        onChange={(e, v) => setTab(v)}
        sx={{ mb: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Tab
          label={
            <Badge color="primary" badgeContent={counts?.friends || 0} max={999}>
              <Box sx={{ pr: 2 }}>Bạn bè</Box>
            </Badge>
          }
        />
        <Tab
          label={
            <Badge color="error" badgeContent={counts?.incoming || 0} max={99}>
              <Box sx={{ pr: 2 }}>Lời mời đã nhận</Box>
            </Badge>
          }
        />
        <Tab
          label={
            <Badge color="default" badgeContent={counts?.outgoing || 0} max={99}>
              <Box sx={{ pr: 2 }}>Đã gửi</Box>
            </Badge>
          }
        />
      </Tabs>
      <Box sx={{ mt: 2, borderRadius: 2, border: 1, borderColor: "divider" }}>
        {tab === 0 && <FriendsTab />}
        {tab === 1 && <IncomingTab />}
        {tab === 2 && <OutgoingTab />}
      </Box>
    </Box>
  );
}
