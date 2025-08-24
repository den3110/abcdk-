// src/components/MobileBottomNav.jsx – Bottom Navigation bar for mobile using MUI
import React, { useState, useEffect } from "react";
import { BottomNavigation, BottomNavigationAction, Paper } from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import HomeIcon from "@mui/icons-material/Home";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ContactMailIcon from "@mui/icons-material/ContactMail";
import PersonIcon from "@mui/icons-material/Person";

const navItems = [
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
  { label: "Liên hệ", icon: <ContactMailIcon />, path: "/contact" },
  { label: "Profile", icon: <PersonIcon />, path: "/profile" },
];

// Chọn tab theo “khớp dài nhất” với URL hiện tại
function indexFromPath(pathname) {
  let bestIdx = 0;
  let bestLen = -1;
  navItems.forEach((item, idx) => {
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

  const [value, setValue] = useState(() => indexFromPath(location.pathname));

  useEffect(() => {
    setValue(indexFromPath(location.pathname));
  }, [location.pathname]);

  const handleChange = (event, newValue) => {
    setValue(newValue);
    navigate(navItems[newValue].path);
  };

  return (
    <Paper
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        display: { xs: "block", md: "none" },
        zIndex: 1300,
      }}
      elevation={3}
    >
      <BottomNavigation
        value={value}
        onChange={handleChange}
        showLabels
        sx={{
          // Không cho label xuống dòng + ellipsis
          "& .MuiBottomNavigationAction-label": {
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          },
        }}
      >
        {navItems.map((item) => (
          <BottomNavigationAction
            key={item.label}
            label={item.label}
            icon={item.icon}
            // (optional) nếu vẫn chật có thể giảm icon size:
            // icon={React.cloneElement(item.icon, { fontSize: "small" })}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
};

export default MobileBottomNav;
