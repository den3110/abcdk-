// src/components/MobileBottomNav.jsx
import { useState, useEffect, useMemo } from "react";
import {
  BottomNavigation,
  BottomNavigationAction,
  Paper,
  useMediaQuery,
} from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import { useSelector } from "react-redux";

import HomeIcon from "@mui/icons-material/Home";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import AssessmentIcon from "@mui/icons-material/Assessment";
import PersonIcon from "@mui/icons-material/Person";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";

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
    if (isAdmin) {
      base.splice(base.length - 1, 0, {
        label: "Quản trị",
        icon: <AdminPanelSettingsIcon />,
        path: "/admin",
      });
    }
    return base;
  }, [isAdmin]);

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

  // Style tránh tràn chữ & giữ chiều cao gọn gàng
  const navSx = useMemo(
    () => ({
      "& .MuiBottomNavigationAction-root": {
        minWidth: isAdmin ? 56 : 60, // bóp nhỏ để đủ chỗ 5–6 tab
        padding: "6px 4px",
        flex: 1, // chia đều, không đùn nhau
        maxWidth: "none",
      },
      "& .MuiSvgIcon-root": {
        fontSize: isVeryNarrow ? "1.15rem" : isNarrow ? "1.25rem" : "1.35rem",
      },
      "& .MuiBottomNavigationAction-label": {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 72, // giới hạn để không bể layout
        lineHeight: 1.1,
        fontSize: isVeryNarrow ? 9 : isNarrow ? 10 : 11,
        marginTop: 1,
      },
      "& .Mui-selected .MuiBottomNavigationAction-label": {
        // MUI mặc định tăng size khi selected — vẫn giữ 1 dòng + không làm cao thanh nav
        fontSize: isVeryNarrow ? 10 : isNarrow ? 11 : 12,
      },
    }),
    [isAdmin, isNarrow, isVeryNarrow]
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
        overflow: "hidden", // đề phòng tràn ngang hiếm gặp
      }}
      elevation={3}
    >
      <BottomNavigation
        value={value}
        onChange={handleChange}
        // Màn quá hẹp: chỉ hiện label cho tab đang chọn để tiết kiệm chiều ngang
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
