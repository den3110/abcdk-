import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Stack,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import HomeIcon from "@mui/icons-material/HomeRounded";
import EmojiEventsIcon from "@mui/icons-material/EmojiEventsRounded";
import AssessmentIcon from "@mui/icons-material/AssessmentRounded";
import PersonIcon from "@mui/icons-material/PersonRounded";
import EventAvailableIcon from "@mui/icons-material/EventAvailableRounded";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import GroupsIcon from "@mui/icons-material/GroupsRounded";
import NewspaperIcon from "@mui/icons-material/NewspaperRounded";

import { useLanguage } from "../context/LanguageContext.jsx";

const CLUB_BADGE_START = new Date(2025, 9, 5, 0, 0, 0, 0);
const CLUB_BADGE_END = new Date(2025, 10, 5, 23, 59, 59, 999);

const getEffectiveBackgroundColor = (element) => {
  if (!element) return [255, 255, 255];
  const style = window.getComputedStyle(element);
  const color = style.backgroundColor;
  const rgb = color.match(/\d+/g);

  if (!rgb || (rgb.length === 4 && parseInt(rgb[3], 10) === 0)) {
    return element.parentElement
      ? getEffectiveBackgroundColor(element.parentElement)
      : [255, 255, 255];
  }

  return [parseInt(rgb[0], 10), parseInt(rgb[1], 10), parseInt(rgb[2], 10)];
};

const isColorDark = (rgb) => {
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  return brightness < 128;
};

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const isAdminUser = (user) => {
  if (!user) return false;

  const roles = new Set(
    Array.isArray(user?.roles) ? user.roles.map(normalizeRole) : []
  );

  if (user?.role) roles.add(normalizeRole(user.role));
  if (user?.isAdmin) roles.add("admin");

  return roles.has("admin");
};

export default function MobileBottomNav() {
  const theme = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(null);
  const { t } = useLanguage();

  const [isDarkOverlay, setIsDarkOverlay] = useState(false);

  const detectBackground = useCallback(() => {
    if (!navRef.current) return;

    const rect = navRef.current.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const samplePoints = [0.1, 0.3, 0.5, 0.7, 0.9].map(
      (ratio) => window.innerWidth * ratio
    );

    let darkCount = 0;
    samplePoints.forEach((x) => {
      const elements = document.elementsFromPoint(x, centerY);
      const target = elements.find(
        (element) => !navRef.current.contains(element)
      );
      if (!target) return;
      if (isColorDark(getEffectiveBackgroundColor(target))) {
        darkCount += 1;
      }
    });

    setIsDarkOverlay(darkCount / samplePoints.length > 0.5);
  }, []);

  useEffect(() => {
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      window.requestAnimationFrame(() => {
        detectBackground();
        ticking = false;
      });
      ticking = true;
    };

    window.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);

    let debounceTimer;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        detectBackground();
      }, 200);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    detectBackground();

    const retryTimers = [
      setTimeout(detectBackground, 300),
      setTimeout(detectBackground, 800),
    ];

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer.disconnect();
      clearTimeout(debounceTimer);
      retryTimers.forEach(clearTimeout);
    };
  }, [detectBackground]);

  const user = useSelector(
    (state) => state.auth?.userInfo || state.userLogin?.userInfo || null
  );
  const isAdmin = isAdminUser(user);
  const isSmallScreen = useMediaQuery("(max-width:380px)");

  const showClubNewBadge = useMemo(() => {
    const now = new Date();
    return now >= CLUB_BADGE_START && now <= CLUB_BADGE_END;
  }, []);

  const items = useMemo(() => {
    const base = [
      { label: t("mobileNav.home"), icon: <HomeIcon />, path: "/" },
      {
        label: t("mobileNav.tournaments"),
        icon: <EmojiEventsIcon />,
        path: "/pickle-ball/tournaments",
      },
      {
        label: t("mobileNav.news"),
        icon: <NewspaperIcon />,
        path: "/news",
      },
      {
        label: t("mobileNav.rankings"),
        icon: <AssessmentIcon />,
        path: "/pickle-ball/rankings",
      },
      {
        label: t("mobileNav.mine"),
        icon: <EventAvailableIcon />,
        path: "/my-tournaments",
      },
      {
        label: t("mobileNav.profile"),
        icon: <PersonIcon />,
        path: "/profile",
      },
    ];

    if (user) {
      const clubIcon = showClubNewBadge ? (
        <Badge
          color="error"
          variant="dot"
          sx={{
            "& .MuiBadge-badge": {
              top: 2,
              right: 2,
              border: `2px solid ${theme.palette.background.paper}`,
            },
          }}
        >
          <GroupsIcon />
        </Badge>
      ) : (
        <GroupsIcon />
      );

      base.splice(base.length - 1, 0, {
        label: t("mobileNav.clubs"),
        icon: clubIcon,
        path: "/clubs",
      });
    }

    if (isAdmin) {
      base.splice(base.length - 1, 0, {
        label: t("mobileNav.admin"),
        icon: <AdminPanelSettingsIcon />,
        path: "/admin",
      });
    }

    return base;
  }, [isAdmin, showClubNewBadge, t, theme, user]);

  const activeIndex = useMemo(() => {
    let bestIndex = 0;
    let bestLength = -1;

    items.forEach((item, index) => {
      if (item.path === "/" && location.pathname === "/") {
        bestIndex = index;
        bestLength = item.path.length;
        return;
      }

      if (
        item.path !== "/" &&
        (location.pathname === item.path ||
          location.pathname.startsWith(`${item.path}/`))
      ) {
        if (item.path.length > bestLength) {
          bestIndex = index;
          bestLength = item.path.length;
        }
      }
    });

    return bestIndex;
  }, [items, location.pathname]);

  const glassBackground = isDarkOverlay
    ? "rgba(35, 35, 35, 0.2)"
    : "rgba(255, 255, 255, 0.2)";
  const glassBorder = isDarkOverlay
    ? "rgba(255, 255, 255, 0.15)"
    : "rgba(255, 255, 255, 0.4)";
  const inactiveColor = isDarkOverlay
    ? "rgba(255, 255, 255, 0.6)"
    : theme.palette.text.secondary;
  const activePillBg = isDarkOverlay
    ? "rgba(255, 255, 255, 0.2)"
    : alpha(theme.palette.primary.main, 0.15);
  const activeIconColor = isDarkOverlay
    ? "#90caf9"
    : theme.palette.primary.main;

  return (
    <Box
      ref={navRef}
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1199,
        display: { xs: "flex", md: "none" },
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <Stack
        direction="row"
        sx={{
          pointerEvents: "auto",
          width: "calc(100% - 32px)",
          maxWidth: 550,
          margin: "0 auto",
          mb: `calc(12px + env(safe-area-inset-bottom))`,
          height: 64,
          borderRadius: 9999,
          background: glassBackground,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: `1px solid ${glassBorder}`,
          boxShadow: isDarkOverlay
            ? "0 20px 40px rgba(0,0,0,0.6)"
            : "0 10px 30px rgba(0,0,0,0.15)",
          alignItems: "center",
          justifyContent: "space-around",
          padding: "0 8px",
          transition:
            "background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease",
        }}
      >
        {items.map((item, index) => {
          const active = index === activeIndex;

          return (
            <Box
              key={item.path}
              onClick={() => navigate(item.path)}
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                flex: 1,
                cursor: "pointer",
                minWidth: 0,
                transition: "all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1.2)",
                transform: active ? "scale(1.05)" : "scale(1)",
                color: active ? activeIconColor : inactiveColor,
                opacity: isSmallScreen && !active ? 0.7 : 1,
                "&:active": { transform: "scale(0.95)" },
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Box
                sx={{
                  padding: "6px 16px",
                  borderRadius: 9999,
                  marginBottom: "2px",
                  transition: "background-color 0.3s ease",
                  backgroundColor: active ? activePillBg : "transparent",
                  "& svg": {
                    fontSize: "1.5rem",
                    display: "block",
                    filter: active
                      ? `drop-shadow(0 2px 4px ${alpha(activeIconColor, 0.4)})`
                      : "none",
                  },
                }}
              >
                {item.icon}
              </Box>

              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.6rem",
                  fontWeight: active ? 700 : 500,
                  letterSpacing: "0.4px",
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "100%",
                  display: items.length > 5 && !active ? "none" : "block",
                }}
              >
                {item.label}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}
