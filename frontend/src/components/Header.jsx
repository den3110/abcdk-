import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Container,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  ArrowBackIosNew as BackIcon,
  DarkMode as DarkModeIcon,
  KeyboardArrowDownRounded as ChevronDownIcon,
  LightMode as LightModeIcon,
  SearchRounded as SearchIcon,
} from "@mui/icons-material";

import { logout } from "../slices/authSlice";
import { useLogoutMutation } from "../slices/usersApiSlice";
import { useThemeMode } from "../context/ThemeContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useCommandPalette } from "../context/CommandPaletteContext.jsx";
import LogoAnimationMorph from "./LogoAnimationMorph.jsx";
import LanguageSwitcher from "./LanguageSwitcher.jsx";

const CLUB_BADGE_START = new Date(2025, 9, 5, 0, 0, 0, 0);
const CLUB_BADGE_END = new Date(2025, 10, 5, 23, 59, 59, 999);

const pulseKeyframes = {
  "@keyframes pulse": {
    "0%": { boxShadow: "0 0 0 0 rgba(255, 68, 68, 0.7)" },
    "70%": { boxShadow: "0 0 0 6px rgba(255, 68, 68, 0)" },
    "100%": { boxShadow: "0 0 0 0 rgba(255, 68, 68, 0)" },
  },
};

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isAdminUser(user) {
  if (!user) return false;

  const roles = new Set(
    Array.isArray(user?.roles) ? user.roles.map(normalizeRole) : [],
  );

  if (user?.role) roles.add(normalizeRole(user.role));
  if (user?.isAdmin === true) roles.add("admin");

  return roles.has("admin");
}

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { userInfo } = useSelector((state) => state.auth);
  const hasUserInfo = Boolean(userInfo);
  const isAdmin = isAdminUser(userInfo);

  const [logoutApiCall] = useLogoutMutation();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { toggleTheme, isDark } = useThemeMode();
  const { t } = useLanguage();
  const { openPalette } = useCommandPalette();

  const navLinks = useMemo(
    () => [
      { label: t("header.nav.tournaments"), path: "/pickle-ball/tournaments" },
      { label: t("header.nav.rankings"), path: "/pickle-ball/rankings" },
    ],
    [t],
  );

  const [canGoBack, setCanGoBack] = useState(false);
  const [userAnchor, setUserAnchor] = useState(null);
  const [moreAnchor, setMoreAnchor] = useState(null);
  const headerScrollPendingRef = useRef(false);
  const moreCloseTimeoutRef = useRef(null);

  const BOTTOM_NAV_TABS = useMemo(
    () =>
      new Set([
        "/",
        "/pickle-ball/tournaments",
        "/pickle-ball/rankings",
        "/my-tournaments",
        "/profile",
        "/clubs",
        "/news",
      ]),
    [],
  );

  const showBackButton =
    isMobile && canGoBack && !BOTTOM_NAV_TABS.has(location.pathname);

  const openUserMenu = (event) => setUserAnchor(event.currentTarget);
  const closeUserMenu = () => setUserAnchor(null);
  const clearMoreCloseTimeout = () => {
    if (!moreCloseTimeoutRef.current) return;
    clearTimeout(moreCloseTimeoutRef.current);
    moreCloseTimeoutRef.current = null;
  };
  const openMoreMenu = (event) => {
    clearMoreCloseTimeout();
    setMoreAnchor(event.currentTarget);
  };
  const scheduleCloseMoreMenu = () => {
    clearMoreCloseTimeout();
    moreCloseTimeoutRef.current = setTimeout(() => {
      setMoreAnchor(null);
      moreCloseTimeoutRef.current = null;
    }, 140);
  };
  const closeMoreMenu = () => {
    clearMoreCloseTimeout();
    setMoreAnchor(null);
  };
  const handleMoreMenuClose = (_event, reason) => {
    if (reason === "escapeKeyDown" || reason === "tabKeyDown") {
      closeMoreMenu();
    }
  };
  const ignoreMoreButtonClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearMoreCloseTimeout();
  };

  const scrollToTop = () => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  const isSameHeaderTarget = (path) => {
    if (!path) return false;
    if (path === "/") return location.pathname === "/";
    return (
      location.pathname === path || location.pathname.startsWith(`${path}/`)
    );
  };

  const handleHeaderLinkClick = (path, options = {}) => {
    if (options.closeMenu) closeUserMenu();

    if (isSameHeaderTarget(path)) {
      scrollToTop();
      return;
    }

    headerScrollPendingRef.current = true;
  };

  const navigateWithScroll = (to) => {
    headerScrollPendingRef.current = true;
    navigate(to);
  };

  const goBackWithScroll = () => {
    headerScrollPendingRef.current = true;
    navigate(-1);
  };

  const logoutHandler = async () => {
    try {
      setUserAnchor(null);
      await logoutApiCall().unwrap();
      dispatch(logout());
      navigateWithScroll("/login");
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    try {
      const state = window.history?.state;
      if (state && typeof state.idx === "number") {
        setCanGoBack(state.idx > 0);
      } else {
        setCanGoBack(Boolean(document.referrer));
      }
    } catch {
      setCanGoBack(false);
    }
  }, [location.key]);

  useEffect(() => {
    setUserAnchor(null);
    if (moreCloseTimeoutRef.current) {
      clearTimeout(moreCloseTimeoutRef.current);
      moreCloseTimeoutRef.current = null;
    }
    setMoreAnchor(null);
  }, [location.pathname, hasUserInfo]);

  useEffect(
    () => () => {
      if (moreCloseTimeoutRef.current) {
        clearTimeout(moreCloseTimeoutRef.current);
        moreCloseTimeoutRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!headerScrollPendingRef.current) return;

    headerScrollPendingRef.current = false;
    window.requestAnimationFrame(() => {
      scrollToTop();
    });
  }, [location.key]);

  const avatarInitial =
    (userInfo?.name || userInfo?.nickname || userInfo?.email || "?")
      .toString()
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  const showClubNewBadge = useMemo(() => {
    const now = new Date();
    return now >= CLUB_BADGE_START && now <= CLUB_BADGE_END;
  }, []);

  const liveCount = 0;

  const isActive = (path) => {
    if (path === "/" && location.pathname !== "/") return false;
    return location.pathname.startsWith(path);
  };

  const moreMenuItems = useMemo(() => {
    const items = [
      { label: t("header.nav.news"), path: "/news" },
      { label: "Docs", path: "/docs/api" },
    ];

    if (userInfo) {
      items.push({
        label: t("header.nav.myTournaments"),
        path: "/my-tournaments",
      });
      items.push({
        label: t("header.nav.clubs"),
        path: "/clubs",
        badge: showClubNewBadge ? "NEW" : "",
      });
    }

    if (isAdmin) {
      items.push({ label: t("header.nav.admin"), path: "/admin" });
    }

    return items;
  }, [t, userInfo, isAdmin, showClubNewBadge]);

  const isMoreActive = moreMenuItems.some((item) => isActive(item.path));

  const getNavButtonStyle = (path) => {
    const active = isActive(path);

    return {
      color: active ? theme.palette.primary.main : "text.primary",
      bgcolor: active ? alpha(theme.palette.primary.main, 0.08) : "transparent",
      textTransform: "none",
      fontWeight: active ? 700 : 600,
      fontSize: "0.95rem",
      borderRadius: "8px",
      px: 1.5,
      py: 0.8,
      "&:hover": {
        backgroundColor: alpha(theme.palette.primary.main, 0.12),
        color: theme.palette.primary.main,
      },
      transition: "all 0.2s",
    };
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: isDark
          ? "rgba(18, 18, 18, 0.65)"
          : "rgba(255, 255, 255, 0.75)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderRadius: { xs: 0, md: "100px" },
        top: { xs: 0, md: 24 },
        mt: { xs: 0, md: 3 },
        mx: "auto",
        width: { xs: "100%", md: "94%", lg: "1320px" },
        border: isDark
          ? "1px solid rgba(255, 255, 255, 0.08)"
          : "1px solid rgba(255, 255, 255, 0.4)",
        boxShadow: isDark
          ? "0 20px 40px -10px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)"
          : "0 20px 40px -10px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.5)",
        zIndex: 1199,
        transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        ...pulseKeyframes,
      }}
    >
      <Container maxWidth="xl" sx={{ px: { xs: 1.5, md: 4 } }}>
        <Toolbar
          disableGutters
          sx={{
            justifyContent: "space-between",
            height: { xs: 56, md: 64 },
            position: "relative",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              width: { xs: "100%", md: "auto" },
            }}
          >
            {showBackButton ? (
              <IconButton
                aria-label={t("header.actions.back")}
                onClick={goBackWithScroll}
                size="small"
                sx={{
                  position: "absolute",
                  left: 0,
                  color: "text.primary",
                  p: 1,
                }}
              >
                <BackIcon fontSize="small" />
              </IconButton>
            ) : null}

            <LogoAnimationMorph
              isMobile={isMobile}
              showBackButton={showBackButton}
            />

            <Divider
              orientation="vertical"
              flexItem
              sx={{
                mx: 2,
                height: 24,
                alignSelf: "center",
                display: { xs: "none", md: "block" },
              }}
            />

            <Box
              sx={{
                display: { xs: "none", md: "flex" },
                gap: 0.5,
                alignItems: "center",
              }}
            >
              {navLinks.map((sub) => (
                <Button
                  key={sub.path}
                  component={Link}
                  to={sub.path}
                  sx={getNavButtonStyle(sub.path)}
                  onClick={() => handleHeaderLinkClick(sub.path)}
                >
                  {sub.label}
                </Button>
              ))}

              <Button
                component={Link}
                to="/live"
                onClick={() => handleHeaderLinkClick("/live")}
                sx={{
                  ...getNavButtonStyle("/live"),
                  color: isActive("/live")
                    ? "#d32f2f"
                    : liveCount > 0
                      ? "#d32f2f"
                      : "text.secondary",
                  bgcolor: isActive("/live")
                    ? alpha("#d32f2f", 0.08)
                    : "transparent",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  "&:hover": {
                    backgroundColor: alpha("#d32f2f", 0.12),
                    color: "#d32f2f",
                  },
                }}
              >
                {liveCount > 0 ? (
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      bgcolor: "#d32f2f",
                      animation: "pulse 1.5s infinite",
                      boxShadow: "0 0 0 0 rgba(255, 68, 68, 0.7)",
                    }}
                  />
                ) : null}
                {t("header.nav.live")}
                {liveCount > 0 ? (
                  <Box
                    component="span"
                    sx={{
                      ml: 0.5,
                      bgcolor: alpha(theme.palette.error.main, 0.1),
                      color: "#c62828",
                      px: 0.8,
                      borderRadius: "10px",
                      fontSize: "0.75rem",
                      lineHeight: 1.4,
                    }}
                  >
                    {liveCount > 99 ? "99+" : liveCount}
                  </Box>
                ) : null}
              </Button>

              <Box
                onMouseEnter={openMoreMenu}
                onMouseLeave={scheduleCloseMoreMenu}
                sx={{ display: "flex", alignItems: "center" }}
              >
                <Button
                  aria-haspopup="menu"
                  aria-expanded={moreAnchor ? "true" : undefined}
                  onMouseDown={ignoreMoreButtonClick}
                  onClick={ignoreMoreButtonClick}
                  disableRipple
                  sx={{
                    ...getNavButtonStyle("__more__"),
                    color:
                      isMoreActive || moreAnchor
                        ? theme.palette.primary.main
                        : "text.primary",
                    bgcolor:
                      isMoreActive || moreAnchor
                        ? alpha(theme.palette.primary.main, 0.08)
                        : "transparent",
                    pr: 1,
                    gap: 0.35,
                  }}
                >
                  {t("header.nav.more")}
                  <ChevronDownIcon
                    sx={{
                      fontSize: 18,
                      transition: "transform 0.2s ease",
                      transform: moreAnchor
                        ? "rotate(180deg)"
                        : "rotate(0deg)",
                    }}
                  />
                </Button>

                <Menu
                  anchorEl={moreAnchor}
                  open={!!moreAnchor}
                  onClose={handleMoreMenuClose}
                  hideBackdrop
                  MenuListProps={{
                    onMouseEnter: clearMoreCloseTimeout,
                    onMouseLeave: scheduleCloseMoreMenu,
                    sx: {
                      py: 0.75,
                    },
                  }}
                  PaperProps={{
                    onMouseEnter: clearMoreCloseTimeout,
                    onMouseLeave: scheduleCloseMoreMenu,
                    elevation: 0,
                    sx: {
                      mt: 1,
                      minWidth: 220,
                      borderRadius: 3,
                      border: `1px solid ${alpha(theme.palette.text.primary, isDark ? 0.12 : 0.08)}`,
                      backgroundImage: isDark
                        ? "linear-gradient(180deg, rgba(24,24,27,0.96), rgba(18,18,18,0.98))"
                        : "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))",
                      backdropFilter: "blur(18px)",
                      WebkitBackdropFilter: "blur(18px)",
                      boxShadow: isDark
                        ? "0 22px 50px -18px rgba(0,0,0,0.6)"
                        : "0 22px 50px -18px rgba(15,23,42,0.18)",
                      overflow: "visible",
                    },
                  }}
                  transformOrigin={{ horizontal: "center", vertical: "top" }}
                  anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
                >
                  {moreMenuItems.map((item) => (
                    <MenuItem
                      key={item.path}
                      component={Link}
                      to={item.path}
                      onClick={() => {
                        handleHeaderLinkClick(item.path);
                        closeMoreMenu();
                      }}
                      sx={{
                        mx: 0.75,
                        my: 0.25,
                        borderRadius: 2,
                        minHeight: 42,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 1,
                        color: isActive(item.path)
                          ? theme.palette.primary.main
                          : "text.primary",
                        bgcolor: isActive(item.path)
                          ? alpha(theme.palette.primary.main, 0.08)
                          : "transparent",
                        fontWeight: isActive(item.path) ? 700 : 600,
                        "&:hover": {
                          bgcolor: alpha(theme.palette.primary.main, 0.1),
                        },
                      }}
                    >
                      <Box component="span">{item.label}</Box>
                      {item.badge ? (
                        <Box
                          component="span"
                          sx={{
                            bgcolor: "error.main",
                            color: "common.white",
                            fontSize: "0.65rem",
                            fontWeight: 800,
                            lineHeight: 1,
                            px: 0.7,
                            py: 0.35,
                            borderRadius: 999,
                            letterSpacing: "0.04em",
                          }}
                        >
                          {item.badge}
                        </Box>
                      ) : null}
                    </MenuItem>
                  ))}
                </Menu>
              </Box>

            </Box>
          </Box>

          <Box
            sx={{
              display: { xs: "flex", md: "none" },
              position: "absolute",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <Tooltip title={t("commandPalette.triggerAria")}>
              <IconButton
                onClick={openPalette}
                size="small"
                aria-label={t("commandPalette.triggerAria")}
                sx={{
                  border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
                  bgcolor: alpha(theme.palette.background.paper, 0.72),
                  backdropFilter: "blur(10px)",
                }}
              >
                <SearchIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <LanguageSwitcher compact />
          </Box>

          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              alignItems: "center",
              gap: 1,
            }}
          >
            <Tooltip title={t("commandPalette.triggerAria")}>
              <Button
                onClick={openPalette}
                variant="text"
                aria-label={t("commandPalette.triggerAria")}
                sx={{
                  minWidth: 0,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: { md: 0.75, xl: 1 },
                  height: 44,
                  px: { md: 0.9, xl: 1.25 },
                  borderRadius: "999px",
                  textTransform: "none",
                  color: "text.secondary",
                  border: `1px solid ${alpha(theme.palette.text.primary, isDark ? 0.12 : 0.08)}`,
                  backgroundImage: isDark
                    ? "linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))"
                    : "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(248,250,252,0.76))",
                  boxShadow: isDark
                    ? "inset 0 1px 0 rgba(255,255,255,0.06)"
                    : "inset 0 1px 0 rgba(255,255,255,0.85)",
                  backdropFilter: "blur(14px)",
                  WebkitBackdropFilter: "blur(14px)",
                  transition: "all 0.24s ease",
                  "&:hover": {
                    color: theme.palette.primary.main,
                    borderColor: alpha(theme.palette.primary.main, 0.26),
                    backgroundImage: isDark
                      ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.2)}, rgba(255,255,255,0.04))`
                      : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)}, rgba(255,255,255,0.96))`,
                    transform: "translateY(-1px)",
                  },
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: alpha(theme.palette.primary.main, isDark ? 0.18 : 0.1),
                    color: theme.palette.primary.main,
                    flexShrink: 0,
                  }}
                >
                  <SearchIcon sx={{ fontSize: 18 }} />
                </Box>
                <Box
                  component="span"
                  sx={{
                    display: { md: "none", xl: "inline" },
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("commandPalette.triggerLabel")}
                </Box>
                <Box
                  component="span"
                  sx={{
                    px: 0.9,
                    py: 0.45,
                    borderRadius: "999px",
                    fontSize: "0.69rem",
                    fontWeight: 800,
                    lineHeight: 1,
                    color: "text.primary",
                    bgcolor: alpha(theme.palette.text.primary, isDark ? 0.14 : 0.06),
                    border: `1px solid ${alpha(theme.palette.text.primary, isDark ? 0.18 : 0.08)}`,
                    boxShadow: isDark
                      ? "inset 0 1px 0 rgba(255,255,255,0.04)"
                      : "inset 0 1px 0 rgba(255,255,255,0.9)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Ctrl K
                </Box>
              </Button>
            </Tooltip>

            {userInfo ? (
              <>
                <LanguageSwitcher compact />

                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography
                    variant="subtitle2"
                    fontWeight={600}
                    component={Link}
                    to="/profile"
                    onClick={() => handleHeaderLinkClick("/profile")}
                    sx={{
                      lineHeight: 1.2,
                      color: isActive("/profile")
                        ? theme.palette.primary.main
                        : "text.primary",
                      textDecoration: "none",
                      fontWeight: isActive("/profile") ? 700 : 600,
                      "&:hover": {
                        color: theme.palette.primary.main,
                      },
                    }}
                  >
                    {userInfo.nickname || userInfo.name}
                  </Typography>
                </Box>

                <Tooltip
                  title={
                    isDark
                      ? t("header.actions.lightMode")
                      : t("header.actions.darkMode")
                  }
                >
                  <IconButton
                    onClick={toggleTheme}
                    sx={{ color: "text.primary" }}
                  >
                    {isDark ? <LightModeIcon /> : <DarkModeIcon />}
                  </IconButton>
                </Tooltip>

                <Tooltip title={t("header.actions.account")}>
                  <IconButton
                    onClick={openUserMenu}
                    sx={{
                      p: 0.5,
                      border: "2px solid",
                      borderColor: "transparent",
                      "&:hover": {
                        borderColor: alpha(theme.palette.primary.main, 0.2),
                      },
                      transition: "all 0.2s",
                    }}
                  >
                    <Avatar
                      alt={userInfo?.name}
                      src={userInfo?.avatar || ""}
                      sx={{
                        width: 36,
                        height: 36,
                        bgcolor: theme.palette.primary.main,
                        fontSize: "0.9rem",
                        fontWeight: 700,
                      }}
                    >
                      {avatarInitial}
                    </Avatar>
                  </IconButton>
                </Tooltip>

                <Menu
                  anchorEl={userAnchor}
                  open={Boolean(userAnchor)}
                  onClose={closeUserMenu}
                  PaperProps={{
                    elevation: 0,
                    sx: {
                      overflow: "visible",
                      filter: "drop-shadow(0px 5px 15px rgba(0,0,0,0.1))",
                      mt: 1.5,
                      minWidth: 180,
                      "& .MuiAvatar-root": {
                        width: 32,
                        height: 32,
                        ml: -0.5,
                        mr: 1,
                      },
                      "&:before": {
                        content: '""',
                        display: "block",
                        position: "absolute",
                        top: 0,
                        right: 14,
                        width: 10,
                        height: 10,
                        bgcolor: "background.paper",
                        transform: "translateY(-50%) rotate(45deg)",
                        zIndex: 0,
                      },
                    },
                  }}
                  transformOrigin={{ horizontal: "right", vertical: "top" }}
                  anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
                >
                  <MenuItem
                    component={Link}
                    to="/profile"
                    onClick={() =>
                      handleHeaderLinkClick("/profile", { closeMenu: true })
                    }
                    sx={{ fontWeight: 500 }}
                  >
                    {t("header.actions.profile")}
                  </MenuItem>
                  <Divider />
                  <MenuItem
                    onClick={logoutHandler}
                    sx={{ color: "error.main", fontWeight: 500 }}
                  >
                    {t("header.actions.logout")}
                  </MenuItem>
                </Menu>
              </>
            ) : (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <LanguageSwitcher compact />

                <Tooltip
                  title={
                    isDark
                      ? t("header.actions.lightMode")
                      : t("header.actions.darkMode")
                  }
                >
                  <IconButton
                    onClick={toggleTheme}
                    sx={{ color: "text.primary" }}
                  >
                    {isDark ? <LightModeIcon /> : <DarkModeIcon />}
                  </IconButton>
                </Tooltip>

                <Button
                  component={Link}
                  to="/login"
                  variant="text"
                  onClick={() => handleHeaderLinkClick("/login")}
                  sx={{
                    borderRadius: "50px",
                    fontWeight: 600,
                    color: "text.primary",
                    px: 3,
                    py: 1,
                    textTransform: "none",
                    transition: "all 0.3s ease",
                    "&:hover": {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(0,0,0,0.05)",
                    },
                  }}
                >
                  {t("header.actions.login")}
                </Button>

                <Button
                  component={Link}
                  to="/register"
                  variant="contained"
                  disableElevation
                  onClick={() => handleHeaderLinkClick("/register")}
                  sx={{
                    borderRadius: "50px",
                    fontWeight: 700,
                    backgroundColor: isDark ? "#fff" : "#111",
                    color: isDark ? "#000" : "#fff",
                    px: 3.5,
                    py: 1,
                    textTransform: "none",
                    transition: "all 0.3s ease",
                    boxShadow: isDark
                      ? "0 4px 14px rgba(255,255,255,0.15)"
                      : "0 4px 14px rgba(0,0,0,0.15)",
                    "&:hover": {
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.9)"
                        : "rgba(0,0,0,0.8)",
                      transform: "translateY(-1px)",
                      boxShadow: isDark
                        ? "0 6px 20px rgba(255,255,255,0.2)"
                        : "0 6px 20px rgba(0,0,0,0.2)",
                    },
                  }}
                >
                  {t("header.actions.register")}
                </Button>
              </Box>
            )}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}
