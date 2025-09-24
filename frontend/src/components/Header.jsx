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
} from "@mui/material";

import {
  ArrowBackIosNew as BackIcon,
  Login as LoginIcon,
  HowToReg as HowToRegIcon,
} from "@mui/icons-material";

// Chỉ Pickleball
const navConfig = [
  {
    label: "Pickle Ball",
    submenu: [
      { label: "Giải đấu", path: "/pickle-ball/tournaments" },
      { label: "Điểm trình", path: "/pickle-ball/rankings" },
    ],
  },
];

const Header = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { userInfo } = useSelector((state) => state.auth);
  const isAdmin = userInfo?.role === "admin" || userInfo?.isAdmin === true;

  const [logoutApiCall] = useLogoutMutation();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  // Điều hướng back cho mobile
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

  // Anchor cho menu user (chỉ desktop)
  const [userAnchor, setUserAnchor] = useState(null);
  const openUserMenu = (e) => setUserAnchor(e.currentTarget);
  const closeUserMenu = () => setUserAnchor(null);

  const logoutHandler = async () => {
    try {
      setUserAnchor(null); // đóng trước khi điều hướng
      await logoutApiCall().unwrap();
      dispatch(logout());
      navigate("/login");
    } catch (err) {
      console.error(err);
    }
  };

  // Tính toán khả năng back mỗi lần đổi route
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

  // Đóng user menu khi đổi route hoặc trạng thái đăng nhập thay đổi
  useEffect(() => {
    setUserAnchor(null);
  }, [location.pathname, !!userInfo]);

  const avatarInitial =
    (userInfo?.name || userInfo?.nickname || userInfo?.email || "?")
      .toString()
      .trim()
      .charAt(0)
      .toUpperCase() || "?";

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

          {/* Nav links hiển thị trực tiếp (desktop) */}
          <Box sx={{ display: { xs: "none", md: "flex" }, gap: 1 }}>
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
              <Button
                component={Link}
                to="/my-tournaments"
                sx={{ color: "white", textTransform: "none" }}
              >
                Giải của tôi
              </Button>
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

        {/* Phải: User controls (desktop). Trên mobile: không hiển thị menu nào */}
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
            // Nút đăng nhập/đăng ký (chỉ desktop)
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
          {/* ❌ Không có hamburger / mobile menu nữa */}
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
