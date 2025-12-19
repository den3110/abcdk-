// src/components/Header.jsx
import React, { useMemo, useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { logout } from "../slices/authSlice";
import { useLogoutMutation } from "../slices/usersApiSlice";

import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Avatar,
  Tooltip,
  useTheme,
  useMediaQuery,
  Container,
  Divider,
  alpha,
} from "@mui/material";

import {
  ArrowBackIosNew as BackIcon,
  PersonAdd as PersonAddIcon,
} from "@mui/icons-material";

import { useGetLiveMatchesQuery } from "../slices/liveApiSlice";

/* ================== Cấu hình & Constants ================== */
const navConfig = [
  {
    label: "Pickleball",
    submenu: [
      { label: "Giải đấu", path: "/pickle-ball/tournaments" },
      { label: "Điểm trình", path: "/pickle-ball/rankings" },
    ],
  },
];

const CLUB_BADGE_START = new Date(2025, 9, 5, 0, 0, 0, 0);
const CLUB_BADGE_END = new Date(2025, 10, 5, 23, 59, 59, 999);

const pulseKeyframes = {
  "@keyframes pulse": {
    "0%": { boxShadow: "0 0 0 0 rgba(255, 68, 68, 0.7)" },
    "70%": { boxShadow: "0 0 0 6px rgba(255, 68, 68, 0)" },
    "100%": { boxShadow: "0 0 0 0 rgba(255, 68, 68, 0)" },
  },
};

const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { userInfo } = useSelector((state) => state.auth);
  const isAdmin = userInfo?.role === "admin" || userInfo?.isAdmin === true;

  const [logoutApiCall] = useLogoutMutation();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // Điều hướng Back cho mobile
  const [canGoBack, setCanGoBack] = useState(false);
  const BOTTOM_NAV_TABS = useMemo(
    () =>
      new Set([
        "/",
        "/pickle-ball/tournaments",
        "/pickle-ball/rankings",
        "/my-tournaments",
        "/profile",
        "/clubs",
      ]),
    []
  );
  // Logic cũ: Nếu không phải tab chính thì hiện nút back
  const showBackButton =
    isMobile && canGoBack && !BOTTOM_NAV_TABS.has(location.pathname);

  const [userAnchor, setUserAnchor] = useState(null);
  const openUserMenu = (e) => setUserAnchor(e.currentTarget);
  const closeUserMenu = () => setUserAnchor(null);

  const logoutHandler = async () => {
    try {
      setUserAnchor(null);
      await logoutApiCall().unwrap();
      dispatch(logout());
      navigate("/login");
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    try {
      const st = window.history?.state;
      if (st && typeof st.idx === "number") {
        setCanGoBack(st.idx > 0);
      } else {
        setCanGoBack(Boolean(document.referrer));
      }
    } catch {
      setCanGoBack(false);
    }
  }, [location.key]);

  useEffect(() => {
    setUserAnchor(null);
  }, [location.pathname, !!userInfo]);

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
  // const liveCount = liveData?.rawCount ?? 0;
  const liveCount= 0
  console.log(liveData)

  // --- Helper: Kiểm tra Active Tab ---
  const isActive = (path) => {
    if (path === "/" && location.pathname !== "/") return false;
    return location.pathname.startsWith(path);
  };

  // --- Style cho Nav Button (có trạng thái Active) ---
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
        backgroundColor: "rgba(255, 255, 255, 0.9)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid",
        borderColor: "divider",
        top: 0,
        zIndex: 1199,
        ...pulseKeyframes,
      }}
    >
      <Container maxWidth="xl">
        {/* relative để căn chỉnh absolute cho nút Back trên mobile */}
        <Toolbar
          disableGutters
          sx={{
            justifyContent: "space-between",
            height: { xs: 56, md: 64 },
            position: "relative",
          }}
        >
          {/* === LEFT & CENTER LOGO === */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              width: { xs: "100%", md: "auto" },
            }}
          >
            {/* Mobile Back Button (Absolute Left) */}
            {showBackButton && (
              <IconButton
                aria-label="Quay lại"
                onClick={() => navigate(-1)}
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
            )}

            {/* Logo: Desktop (Left) vs Mobile (Center) */}
            <Link
              to="/"
              style={{
                textDecoration: "none",
                flexGrow: isMobile ? 1 : 0, // Mobile: chiếm hết chỗ để text-align center hoạt động
                textAlign: isMobile ? "center" : "left", // Mobile: Căn giữa
                display: "block",
              }}
            >
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 800,
                  background:
                    "linear-gradient(45deg, #0d6efd 30%, #0dcaf0 90%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  letterSpacing: "-0.5px",
                  fontSize: { xs: "1.35rem", md: "1.5rem" },
                  // Đảm bảo logo không bị lệch do nút back
                  mr: isMobile && showBackButton ? 4 : 0,
                  ml: isMobile && showBackButton ? 4 : 0,
                }}
              >
                PickleTour
              </Typography>
            </Link>

            {/* Desktop Divider */}
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

            {/* === DESKTOP NAV LINKS === */}
            <Box
              sx={{
                display: { xs: "none", md: "flex" },
                gap: 0.5,
                alignItems: "center",
              }}
            >
              {navConfig
                .flatMap((item) => item.submenu)
                .map((sub) => (
                  <Button
                    key={sub.path}
                    component={Link}
                    to={sub.path}
                    sx={getNavButtonStyle(sub.path)}
                  >
                    {sub.label}
                  </Button>
                ))}

              {userInfo && (
                <>
                  <Button
                    component={Link}
                    to="/my-tournaments"
                    sx={getNavButtonStyle("/my-tournaments")}
                  >
                    Giải của tôi
                  </Button>

                  <Box sx={{ position: "relative" }}>
                    <Button
                      component={Link}
                      to="/clubs"
                      sx={getNavButtonStyle("/clubs")}
                    >
                      Câu lạc bộ
                    </Button>
                    {showClubNewBadge && (
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
                    )}
                  </Box>
                </>
              )}

              {/* LIVE BUTTON */}
              <Button
                component={Link}
                to="/live"
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
                {liveCount > 0 && (
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
                )}
                Live
                {liveCount > 0 && (
                  <Box
                    component="span"
                    sx={{
                      ml: 0.5,
                      bgcolor: "#ffebee",
                      color: "#c62828",
                      px: 0.8,
                      borderRadius: "10px",
                      fontSize: "0.75rem",
                      lineHeight: 1.4,
                    }}
                  >
                    {liveCount > 99 ? "99+" : liveCount}
                  </Box>
                )}
              </Button>

              {isAdmin && (
                <Button
                  component={Link}
                  to="/admin"
                  sx={getNavButtonStyle("/admin")}
                >
                  Admin
                </Button>
              )}
            </Box>
          </Box>

          {/* === RIGHT: User Controls (DESKTOP ONLY) === */}
          {/* Ẩn hoàn toàn trên Mobile theo yêu cầu */}
          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              alignItems: "center",
              gap: 1.5,
            }}
          >
            {userInfo ? (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  {/* Chỉ hiện Nickname, bỏ Role */}
                  <Typography
                    variant="subtitle2"
                    fontWeight={600}
                    sx={{ lineHeight: 1.2, color: "text.primary" }}
                  >
                    {userInfo.nickname || userInfo.name}
                  </Typography>
                </Box>

                <Tooltip title="Tài khoản">
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
                    onClick={closeUserMenu}
                    sx={{ fontWeight: 500 }}
                  >
                    Hồ sơ cá nhân
                  </MenuItem>
                  <Divider />
                  <MenuItem
                    onClick={logoutHandler}
                    sx={{ color: "error.main", fontWeight: 500 }}
                  >
                    Đăng xuất
                  </MenuItem>
                </Menu>
              </>
            ) : (
              // Desktop Auth Buttons
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  component={Link}
                  to="/login"
                  variant="text"
                  sx={{
                    borderRadius: "50px",
                    fontWeight: 600,
                    color: "text.primary",
                    px: 2.5,
                    textTransform: "none",
                  }}
                >
                  Đăng nhập
                </Button>
                <Button
                  component={Link}
                  to="/register"
                  variant="contained"
                  startIcon={<PersonAddIcon fontSize="small" />}
                  sx={{
                    borderRadius: "50px",
                    fontWeight: 700,
                    boxShadow: "0 4px 12px rgba(13, 110, 253, 0.25)",
                    background:
                      "linear-gradient(45deg, #212121 30%, #424242 90%)",
                    px: 2.5,
                    textTransform: "none",
                  }}
                >
                  Đăng ký
                </Button>
              </Box>
            )}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
};

export default Header;
