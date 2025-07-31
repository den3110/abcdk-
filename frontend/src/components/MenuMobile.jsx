// src/components/MobileBottomNav.jsx – Bottom Navigation bar for mobile using MUI
import React, { useState } from "react";
import { BottomNavigation, BottomNavigationAction, Paper } from "@mui/material";
import { useNavigate, useLocation } from "react-router-dom";
import HomeIcon from "@mui/icons-material/Home";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import AssessmentIcon from "@mui/icons-material/Assessment";
import ContactMailIcon from "@mui/icons-material/ContactMail";

const navItems = [
  {
    label: "Trang chủ",
    icon: <HomeIcon />,
    path: "/",
  },
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
    label: "Liên hệ",
    icon: <ContactMailIcon />,
    path: "/contact",
  },
];

const MobileBottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [value, setValue] = useState(() => {
    const current = navItems.findIndex((item) =>
      location.pathname.startsWith(item.path)
    );
    return current === -1 ? 0 : current;
  });

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
      <BottomNavigation value={value} onChange={handleChange} showLabels>
        {navItems.map((item) => (
          <BottomNavigationAction
            key={item.label}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
};

export default MobileBottomNav;
