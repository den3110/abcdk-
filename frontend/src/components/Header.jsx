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
  Badge,
} from "@mui/material";

import {
  ArrowBackIosNew as BackIcon,
  Login as LoginIcon,
  HowToReg as HowToRegIcon,
} from "@mui/icons-material";

/* ================== Cấu hình ================== */
// Nav Pickleball (desktop)
const navConfig = [
  {
    label: "Pickle Ball",
    submenu: [
      { label: "Giải đấu", path: "/pickle-ball/tournaments" },
      { label: "Điểm trình", path: "/pickle-ball/rankings" },
    ],
  },
];

// Badge "Mới" cho Câu lạc bộ: 05/10/2025 → 05/11/2025 (giờ trình duyệt)
const CLUB_BADGE_START = new Date(2025, 9, 5, 0, 0, 0, 0); // Tháng 10 = 9
const CLUB_BADGE_END = new Date(2025, 10, 5, 23, 59, 59, 999); // Tháng 11 = 10

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
        "/", // Trang chủ
        "/pickle-ball/tournaments",
        "/pickle-ball/rankings",
        "/my-tournaments",
        "/profile",
      ]),
    []
  );
  const isOnBottomNavTab = BOTTOM_NAV_TABS.has(location.pathname);

  // Menu người dùng (desktop)
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

  // Tính toán khả năng back mỗi khi đổi route
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

  // Đóng user menu khi đổi route/đổi trạng thái đăng nhập
  useEffect(() => {
    setUserAnchor(null);
  }, [location.pathname, !!userInfo]);

  // Avatar initial
  const avatarInitial =
    (userInfo?.name || userInfo?.nickname || userInfo?.email || "?")
      .toString()
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

  // Hiển thị badge "Mới" cho Câu lạc bộ trong khoảng thời gian cấu hình
  const showClubNewBadge = useMemo(() => {
    const now = new Date();
    return now >= CLUB_BADGE_START && now <= CLUB_BADGE_END;
  }, []);

  return (
    <AppBar position="static" color="primary" elevation={2}>
      <Toolbar sx={{ px: { xs: 2, sm: 3 }, justifyContent: "space-between" }}>
        {/* Trái: Back (mobile) + Logo + Nav desktop */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {isMobile && canGoBack && !isOnBottomNavTab && (
            <IconButton
              aria-label="Quay lại"
              edge="start"
              onClick={() => navigate(-1)}
              sx={{
                mr: 0.5,
                color: "inherit",
                p: 1,
                "& .MuiSvgIcon-root": { fontSize: 18 },
              }}
            >
              <BackIcon />
            </IconButton>
          )}

          <Typography
            variant="h6"
            component={Link}
            to="/"
            sx={{ textDecoration: "none", color: "inherit", fontWeight: 700 }}
          >
            PickleTour
          </Typography>

          {/* Nav links trực tiếp (desktop) */}
          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              gap: 1,
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
                  sx={{ color: "white", textTransform: "none" }}
                >
                  {sub.label}
                </Button>
              ))}

            {userInfo && (
              <>
                <Button
                  component={Link}
                  to="/my-tournaments"
                  sx={{ color: "white", textTransform: "none" }}
                >
                  Giải của tôi
                </Button>

                {showClubNewBadge ? (
                  <Badge
                    color="error"
                    badgeContent="Mới"
                    overlap="rectangular"
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
                        pointerEvents: "none",
                      },
                    }}
                  >
                    <Button
                      component={Link}
                      to="/clubs"
                      sx={{ color: "white", textTransform: "none" }}
                      aria-label="Câu lạc bộ (tính năng mới)"
                    >
                      Câu lạc bộ
                    </Button>
                  </Badge>
                ) : (
                  <Button
                    component={Link}
                    to="/clubs"
                    sx={{ color: "white", textTransform: "none" }}
                  >
                    Câu lạc bộ
                  </Button>
                )}
              </>
            )}

            {isAdmin && (
              <Button
                component={Link}
                to="/admin"
                sx={{ color: "white", textTransform: "none" }}
              >
                Quản trị
              </Button>
            )}
          </Box>
        </Box>

        {/* Phải: User controls (desktop). Mobile: ẩn menu */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {userInfo ? (
            <>
              {/* Avatar + dropdown (ẩn trên mobile) */}
              <Box sx={{ display: { xs: "none", md: "inline-flex" } }}>
                <Tooltip title="Tài khoản">
                  <IconButton
                    onClick={openUserMenu}
                    sx={{ p: 0 }}
                    aria-haspopup="menu"
                    aria-controls={
                      Boolean(userAnchor) ? "user-menu" : undefined
                    }
                    aria-expanded={Boolean(userAnchor) ? "true" : undefined}
                  >
                    <Avatar alt={userInfo?.name} src={userInfo?.avatar || ""}>
                      {avatarInitial}
                    </Avatar>
                  </IconButton>
                </Tooltip>
              </Box>

              {/* Chỉ render Menu khi có anchor (tránh rơi về (0,0)) */}
              {Boolean(userAnchor) && (
                <Menu
                  id="user-menu"
                  anchorEl={userAnchor}
                  open
                  onClose={closeUserMenu}
                  anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                  transformOrigin={{ vertical: "top", horizontal: "right" }}
                >
                  <MenuItem
                    component={Link}
                    to="/profile"
                    onClick={closeUserMenu}
                  >
                    Tài khoản của tôi
                  </MenuItem>
                  <MenuItem onClick={logoutHandler}>Đăng xuất</MenuItem>
                </Menu>
              )}
            </>
          ) : (
            // Nút đăng nhập/đăng ký (desktop)
            <Box sx={{ display: { xs: "none", md: "flex" }, gap: 1 }}>
              <Button
                component={Link}
                to="/login"
                startIcon={<LoginIcon />}
                variant="outlined"
                color="inherit"
              >
                Đăng nhập
              </Button>
              <Button
                component={Link}
                to="/register"
                startIcon={<HowToRegIcon />}
                variant="contained"
                color="secondary"
              >
                Đăng ký
              </Button>
            </Box>
          )}
          {/* ❌ Không có hamburger / mobile menu */}
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
