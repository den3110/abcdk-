// src/components/MobileBottomNav.jsx
import { useState, useEffect, useMemo } from "react";
import {
  BottomNavigation,
  BottomNavigationAction,
  Paper,
  useMediaQuery,
  Badge, // ⬅️ thêm
} from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";

import HomeIcon from "@mui/icons-material/Home";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PersonIcon from "@mui/icons-material/Person";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import GroupsIcon from "@mui/icons-material/Groups"; // ⬅️ icon Câu lạc bộ

// Badge "Mới" cho Câu lạc bộ: 05/10/2025 → 05/11/2025 (giờ trình duyệt)
const CLUB_BADGE_START = new Date(2025, 9, 5, 0, 0, 0, 0); // Tháng 10 = 9
const CLUB_BADGE_END = new Date(2025, 10, 5, 23, 59, 59, 999); // Tháng 11 = 10

function indexFromPath(pathname, items) {
  let bestIdx = 0;
  let bestLen = -1;
  items.forEach((item, idx) => {
    const p = item.path;
    const matches =
      pathname === p ||
      pathname.startsWith(p + "/") ||
      (p === "/" && pathname === "/");
    if (matches && p.length > bestLen) {
      bestIdx = idx;
      bestLen = p.length;
    }
  });
  return bestIdx;
}

const MobileBottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const user = useSelector(
    (s) =>
      s?.auth?.userInfo ??
      s?.userLogin?.userInfo ??
      s?.user?.userInfo ??
      s?.user ??
      null
  );
  const isAdmin = Boolean(
    user?.isAdmin ||
      user?.role === "admin" ||
      (Array.isArray(user?.roles) && user.roles.includes("admin")) ||
      (Array.isArray(user?.permissions) && user.permissions.includes("admin"))
  );

  // Responsive: màn rất hẹp thì chỉ hiện label cho tab đang chọn
  const isNarrow = useMediaQuery("(max-width:380px)");
  const isVeryNarrow = useMediaQuery("(max-width:330px)");

  // Hiển thị badge "Mới" cho Câu lạc bộ trong khoảng thời gian cấu hình
  const showClubNewBadge = useMemo(() => {
    const now = new Date();
    return now >= CLUB_BADGE_START && now <= CLUB_BADGE_END;
  }, []);

  // Icon có gắn badge
  const ClubIcon = useMemo(
    () =>
      showClubNewBadge ? (
        <Badge
          color="error"
          badgeContent="Mới" // chỉ chữ đầu viết hoa
          overlap="circular"
          sx={{
            "& .MuiBadge-badge": {
              right: -6,
              top: -2,
              fontSize: 10,
              height: 16,
              minWidth: 22,
              px: 0.5,
              fontWeight: 700,
              textTransform: "none",
              pointerEvents: "none", // không chặn click
            },
          }}
        >
          <GroupsIcon />
        </Badge>
      ) : (
        <GroupsIcon />
      ),
    [showClubNewBadge]
  );

  const items = useMemo(() => {
    const base = [
      { label: "Trang chủ", icon: <HomeIcon />, path: "/" },
      {
        label: "Giải đấu",
        icon: <EmojiEventsIcon />,
        path: "/pickle-ball/tournaments",
      },
      {
        label: "Xếp hạng",
        icon: <AssessmentIcon />,
        path: "/pickle-ball/rankings",
      },
      {
        label: "Giải của tôi",
        icon: <EventAvailableIcon />,
        path: "/my-tournaments",
      },
      { label: "Profile", icon: <PersonIcon />, path: "/profile" },
    ];

    // Thêm "Câu lạc bộ" (chỉ khi đã đăng nhập), đặt trước Profile
    if (user) {
      base.splice(base.length - 1, 0, {
        label: "Câu lạc bộ",
        icon: ClubIcon,
        path: "/clubs",
      });
    }

    // Thêm "Quản trị" (nếu là admin), đặt trước Profile
    if (isAdmin) {
      base.splice(base.length - 1, 0, {
        label: "Quản trị",
        icon: <AdminPanelSettingsIcon />,
        path: "/admin",
      });
    }
    return base;
  }, [user, isAdmin, ClubIcon]);

  const [value, setValue] = useState(() =>
    indexFromPath(location.pathname, items)
  );

  useEffect(() => {
    setValue(indexFromPath(location.pathname, items));
  }, [location.pathname, items]);

  const handleChange = (event, newValue) => {
    setValue(newValue);
    navigate(items[newValue].path);
  };
  const NAV_HEIGHT = 64;
  // Style tránh tràn chữ & giữ chiều cao gọn gàng
  const navSx = useMemo(
    () => ({
      height: NAV_HEIGHT,
      "& .MuiBottomNavigationAction-root": {
        minWidth: items.length >= 6 ? 56 : 60, // bóp nhỏ khi có 6+ tab
        padding: "6px 4px",
        flex: 1,
        maxWidth: "none",
      },
      "& .MuiSvgIcon-root": {
        fontSize: isVeryNarrow ? "1.15rem" : isNarrow ? "1.25rem" : "1.35rem",
      },
      "& .MuiBottomNavigationAction-label": {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 72,
        lineHeight: 1.1,
        fontSize: isVeryNarrow ? 9 : isNarrow ? 10 : 11,
        marginTop: 1,
      },
      "& .Mui-selected .MuiBottomNavigationAction-label": {
        fontSize: isVeryNarrow ? 10 : isNarrow ? 11 : 12,
      },
    }),
    [items.length, isNarrow, isVeryNarrow]
  );

  return (
    <Paper
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        display: { xs: "block", md: "none" },
        zIndex: 1300,
        overflow: "hidden",
        height: NAV_HEIGHT,
      }}
      elevation={3}
    >
      <BottomNavigation
        value={value}
        onChange={handleChange}
        showLabels={!isVeryNarrow}
        sx={navSx}
      >
        {items.map((item) => (
          <BottomNavigationAction
            key={item.path}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
};

export default MobileBottomNav;
