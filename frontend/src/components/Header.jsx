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
  LightMode as LightModeIcon,
} from "@mui/icons-material";

import { logout } from "../slices/authSlice";
import { useLogoutMutation } from "../slices/usersApiSlice";
import { useGetLiveMatchesQuery } from "../slices/liveApiSlice";
import { useThemeMode } from "../context/ThemeContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
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

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { userInfo } = useSelector((state) => state.auth);
  const hasUserInfo = Boolean(userInfo);
  const isAdmin = userInfo?.role === "admin" || userInfo?.isAdmin === true;

  const [logoutApiCall] = useLogoutMutation();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { toggleTheme, isDark } = useThemeMode();
  const { t } = useLanguage();

  const navLinks = useMemo(
    () => [
      { label: t("header.nav.tournaments"), path: "/pickle-ball/tournaments" },
      { label: t("header.nav.rankings"), path: "/pickle-ball/rankings" },
    ],
    [t]
  );

  const [canGoBack, setCanGoBack] = useState(false);
  const [userAnchor, setUserAnchor] = useState(null);
  const headerScrollPendingRef = useRef(false);

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
    []
  );

  const showBackButton =
    isMobile && canGoBack && !BOTTOM_NAV_TABS.has(location.pathname);

  const openUserMenu = (event) => setUserAnchor(event.currentTarget);
  const closeUserMenu = () => setUserAnchor(null);

  const scrollToTop = () => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };

  const isSameHeaderTarget = (path) => {
    if (!path) return false;
    if (path === "/") return location.pathname === "/";
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
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
  }, [location.pathname, hasUserInfo]);

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

  const liveQueryArgs = {
    keyword: "",
    page: 0,
    limit: 1,
    statuses: "scheduled,queued,assigned,live",
    excludeFinished: true,
    windowMs: 8 * 3600 * 1000,
  };

  const { data: liveData } = useGetLiveMatchesQuery(liveQueryArgs, {
    pollingInterval: 15000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const liveCount = 0;
  console.log(liveData);

  const isActive = (path) => {
    if (path === "/" && location.pathname !== "/") return false;
    return location.pathname.startsWith(path);
  };

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
                to="/news"
                sx={getNavButtonStyle("/news")}
                onClick={() => handleHeaderLinkClick("/news")}
              >
                {t("header.nav.news")}
              </Button>

              {userInfo ? (
                <>
                  <Button
                    component={Link}
                    to="/my-tournaments"
                    sx={getNavButtonStyle("/my-tournaments")}
                    onClick={() => handleHeaderLinkClick("/my-tournaments")}
                  >
                    {t("header.nav.myTournaments")}
                  </Button>

                  <Box sx={{ position: "relative" }}>
                    <Button
                      component={Link}
                      to="/clubs"
                      sx={getNavButtonStyle("/clubs")}
                      onClick={() => handleHeaderLinkClick("/clubs")}
                    >
                      {t("header.nav.clubs")}
                    </Button>
                    {showClubNewBadge ? (
                      <Box
                        sx={{
                          position: "absolute",
                          top: -2,
                          right: -4,
                          bgcolor: "error.main",
                          color: "white",
                          fontSize: "0.6rem",
                          fontWeight: 700,
                          px: 0.6,
                          py: 0,
                          borderRadius: "4px",
                          pointerEvents: "none",
                        }}
                      >
                        NEW
                      </Box>
                    ) : null}
                  </Box>
                </>
              ) : null}

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

              {isAdmin ? (
                <Button
                  component={Link}
                  to="/admin"
                  sx={getNavButtonStyle("/admin")}
                  onClick={() => handleHeaderLinkClick("/admin")}
                >
                  {t("header.nav.admin")}
                </Button>
              ) : null}
            </Box>
          </Box>

          <Box
            sx={{
              display: { xs: "flex", md: "none" },
              position: "absolute",
              right: 0,
              top: "50%",
              transform: "translateY(-50%)",
            }}
          >
            <LanguageSwitcher compact />
          </Box>

          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              alignItems: "center",
              gap: 1.5,
            }}
          >
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
                  <IconButton onClick={toggleTheme} sx={{ color: "text.primary" }}>
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
                  <IconButton onClick={toggleTheme} sx={{ color: "text.primary" }}>
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
