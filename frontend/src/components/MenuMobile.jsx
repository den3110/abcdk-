// Mobile bottom nav — style Facebook-like giống bản mobile app.
// 6 tab: Trang chủ / Bảng tin / Giải đấu / Xếp hạng / Thông báo / Khác
// - Flat edge-to-edge, không floating pill
// - Per-tab accent colors, active pill sau icon, badge unread cho Thông báo
// - "Khác" mở bottom sheet chứa các link phụ (my-tournaments, clubs, support,
//   profile, admin, ...)
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Avatar,
  Badge,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import EmojiEventsRoundedIcon from "@mui/icons-material/EmojiEventsRounded";
import NewspaperRoundedIcon from "@mui/icons-material/NewspaperRounded";
import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import MoreHorizRoundedIcon from "@mui/icons-material/MoreHorizRounded";
import PersonRoundedIcon from "@mui/icons-material/PersonRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import ChatRoundedIcon from "@mui/icons-material/ChatBubbleRounded";
import PeopleRoundedIcon from "@mui/icons-material/PeopleRounded";
import SportsTennisRoundedIcon from "@mui/icons-material/SportsTennisRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import { useDispatch } from "react-redux";

import { useNotifUnreadCountQuery } from "../slices/notificationCenterApiSlice.js";
import { useLogoutMutation } from "../slices/usersApiSlice.js";
import { logout as logoutAction } from "../slices/authSlice.js";

// Per-tab accent colors — palette đồng bộ với mobile FacebookTabBar
const ACCENT = {
  home: "#1877F2", // blue
  feed: "#8B5CF6", // purple
  tournaments: "#F59E0B", // gold
  rankings: "#10B981", // emerald
  notifications: "#EF4444", // red
  more: "#64748B", // slate
};

const GRADIENT = "linear-gradient(90deg,#1877F2,#8B5CF6,#F59E0B,#10B981,#EF4444)";

const normalizeRole = (r) => String(r || "").trim().toLowerCase();
const isAdminUser = (u) => {
  if (!u) return false;
  const roles = new Set(
    Array.isArray(u?.roles) ? u.roles.map(normalizeRole) : []
  );
  if (u?.role) roles.add(normalizeRole(u.role));
  if (u?.isAdmin) roles.add("admin");
  return roles.has("admin");
};

function TabItem({ tab, active, onPress, badge }) {
  const accent = ACCENT[tab.key];
  const iconColor = active ? accent : "#8A8F98";

  return (
    <Box
      onClick={onPress}
      sx={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        py: 0.5,
        px: 0.25,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: 48,
          height: 32,
          display: "grid",
          placeItems: "center",
        }}
      >
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            borderRadius: 16,
            bgcolor: active ? `${accent}22` : "transparent",
            transform: active ? "scale(1)" : "scale(0.9)",
            opacity: active ? 1 : 0,
            transition: "all .2s cubic-bezier(.2,.8,.2,1.2)",
          }}
        />
        <Box
          sx={{
            position: "relative",
            display: "grid",
            placeItems: "center",
            transform: active ? "scale(1)" : "scale(0.94)",
            transition: "transform .2s cubic-bezier(.2,.8,.2,1.2)",
            color: iconColor,
            "& svg": { fontSize: 24 },
          }}
        >
          {badge != null && badge > 0 ? (
            <Badge
              badgeContent={badge > 99 ? "99+" : badge}
              color="error"
              overlap="circular"
              sx={{
                "& .MuiBadge-badge": {
                  fontSize: 9,
                  minWidth: 16,
                  height: 16,
                  fontWeight: 800,
                  border: "2px solid",
                  borderColor: "background.paper",
                },
              }}
            >
              {tab.icon}
            </Badge>
          ) : (
            tab.icon
          )}
        </Box>
      </Box>
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: active ? 800 : 600,
          color: active ? accent : "#8A8F98",
          mt: 0.5,
          letterSpacing: 0.2,
          maxWidth: "100%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {tab.label}
      </Typography>
    </Box>
  );
}

export default function MobileBottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth?.userInfo);
  const isAdmin = isAdminUser(user);
  const [moreOpen, setMoreOpen] = useState(false);
  const [logoutApi] = useLogoutMutation();

  const { data: unread } = useNotifUnreadCountQuery(undefined, {
    skip: !user,
    pollingInterval: 60000,
  });
  const unreadCount = Number(unread?.count || 0);

  const tabs = useMemo(
    () => [
      { key: "home", label: "Trang chủ", icon: <HomeRoundedIcon />, path: "/" },
      { key: "feed", label: "Bảng tin", icon: <NewspaperRoundedIcon />, path: "/feed" },
      {
        key: "tournaments",
        label: "Giải đấu",
        icon: <EmojiEventsRoundedIcon />,
        path: "/pickle-ball/tournaments",
      },
      {
        key: "rankings",
        label: "Xếp hạng",
        icon: <AssessmentRoundedIcon />,
        path: "/pickle-ball/rankings",
      },
      {
        key: "notifications",
        label: "Thông báo",
        icon: <NotificationsRoundedIcon />,
        path: "/notifications",
      },
      { key: "more", label: "Khác", icon: <MoreHorizRoundedIcon />, path: null },
    ],
    []
  );

  const activeKey = useMemo(() => {
    const p = location.pathname;
    if (p === "/") return "home";
    if (p.startsWith("/feed")) return "feed";
    if (p.startsWith("/pickle-ball/tournaments")) return "tournaments";
    if (p.startsWith("/pickle-ball/rankings")) return "rankings";
    if (p.startsWith("/notifications")) return "notifications";
    return null;
  }, [location.pathname]);

  const handleTab = (tab) => {
    if (tab.key === "more") {
      setMoreOpen(true);
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (location.pathname !== tab.path) navigate(tab.path);
  };

  const moreItems = useMemo(() => {
    const base = [];
    if (user) {
      base.push(
        { label: "Hồ sơ", icon: <PersonRoundedIcon />, path: "/profile" },
        {
          label: "Giải của tôi",
          icon: <EventAvailableRoundedIcon />,
          path: "/my-tournaments",
        },
        { label: "Nhắn tin", icon: <ChatRoundedIcon />, path: "/messages" },
        { label: "Bạn bè", icon: <PeopleRoundedIcon />, path: "/friends" },
        { label: "Huấn luyện viên", icon: <SportsTennisRoundedIcon />, path: "/coaches" },
        { label: "Câu lạc bộ", icon: <GroupsRoundedIcon />, path: "/clubs" },
        { label: "Live", icon: <NewspaperRoundedIcon />, path: "/live" },
        { label: "Hỗ trợ", icon: <SupportAgentRoundedIcon />, path: "/support" }
      );
    }
    if (isAdmin) {
      base.push({
        label: "Quản trị",
        icon: <AdminPanelSettingsRoundedIcon />,
        path: "/admin",
      });
    }
    return base;
  }, [user, isAdmin]);

  const handleLogout = async () => {
    setMoreOpen(false);
    try {
      await logoutApi().unwrap();
    } catch {}
    dispatch(logoutAction());
    navigate("/login");
  };

  return (
    <>
      <Box
        sx={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 1199,
          display: { xs: "block", md: "none" },
          bgcolor: "background.paper",
          borderTop: "1px solid",
          borderColor: "divider",
          boxShadow: "0 -3px 12px rgba(0,0,0,0.08)",
          pb: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Gradient top accent strip */}
        <Box sx={{ height: 2, background: GRADIENT }} />
        <Stack
          direction="row"
          sx={{
            pt: 0.5,
            px: 0,
            alignItems: "center",
          }}
        >
          {tabs.map((tab) => (
            <TabItem
              key={tab.key}
              tab={tab}
              active={activeKey === tab.key}
              onPress={() => handleTab(tab)}
              badge={tab.key === "notifications" ? unreadCount : undefined}
            />
          ))}
        </Stack>
      </Box>

      {/* Bottom sheet "Khác" */}
      <Drawer
        anchor="bottom"
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: "80vh",
          },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            {user && (
              <Avatar src={user?.avatar || ""} sx={{ width: 40, height: 40 }}>
                {(user?.nickname || user?.name || "?")[0]?.toUpperCase()}
              </Avatar>
            )}
            <Box>
              <Typography variant="subtitle1" fontWeight={800}>
                {user?.nickname || user?.name || "Khách"}
              </Typography>
              {user?.email && (
                <Typography variant="caption" color="text.secondary">
                  {user.email}
                </Typography>
              )}
            </Box>
          </Stack>
          <IconButton onClick={() => setMoreOpen(false)} size="small">
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
        <List sx={{ py: 0 }}>
          {moreItems.map((it) => (
            <ListItemButton
              key={it.path}
              onClick={() => {
                setMoreOpen(false);
                navigate(it.path);
              }}
              sx={{ py: 1.25 }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: "text.primary" }}>
                {it.icon}
              </ListItemIcon>
              <ListItemText primary={it.label} />
            </ListItemButton>
          ))}
          {user && (
            <>
              <Divider sx={{ my: 0.5 }} />
              <ListItemButton onClick={handleLogout} sx={{ py: 1.25 }}>
                <ListItemIcon sx={{ minWidth: 40, color: "error.main" }}>
                  <LogoutRoundedIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Đăng xuất"
                  primaryTypographyProps={{ color: "error.main", fontWeight: 600 }}
                />
              </ListItemButton>
            </>
          )}
          {!user && (
            <ListItemButton
              onClick={() => {
                setMoreOpen(false);
                navigate("/login");
              }}
              sx={{ py: 1.25 }}
            >
              <ListItemText
                primary="Đăng nhập"
                primaryTypographyProps={{
                  color: "primary.main",
                  fontWeight: 700,
                  textAlign: "center",
                }}
              />
            </ListItemButton>
          )}
        </List>
        <Box sx={{ pb: "env(safe-area-inset-bottom)" }} />
      </Drawer>
    </>
  );
}
