// src/components/Header.jsx
import React, { useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
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
  Divider,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Login as LoginIcon,
  HowToReg as HowToRegIcon,
} from "@mui/icons-material";
import { useLogoutMutation } from "../slices/usersApiSlice";
import { logout } from "../slices/authSlice";

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
  const { userInfo } = useSelector((state) => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [logoutApiCall] = useLogoutMutation();

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const [mobileAnchor, setMobileAnchor] = useState(null);
  const [userAnchor, setUserAnchor] = useState(null);

  const openMobileMenu = (e) => setMobileAnchor(e.currentTarget);
  const closeMobileMenu = () => setMobileAnchor(null);

  const openUserMenu = (e) => setUserAnchor(e.currentTarget);
  const closeUserMenu = () => setUserAnchor(null);

  const logoutHandler = async () => {
    try {
      await logoutApiCall().unwrap();
      dispatch(logout());
      navigate("/login");
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <AppBar position="static" color="primary" elevation={2}>
      <Toolbar sx={{ px: { xs: 2, sm: 3 }, justifyContent: "space-between" }}>
        {/* Logo + Nav */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
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

            <Button
              component={Link}
              to="/contact"
              sx={{ color: "white", textTransform: "none" }}
            >
              Liên hệ
            </Button>
          </Box>
        </Box>

        {/* User controls */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {userInfo ? (
            <>
              <Tooltip title="Tài khoản">
                <IconButton onClick={openUserMenu} sx={{ p: 0 }}>
                  <Avatar alt={userInfo.name} src={userInfo.avatar || ""}>
                    {userInfo.name?.charAt(0).toUpperCase()}
                  </Avatar>
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={userAnchor}
                open={Boolean(userAnchor)}
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
            </>
          ) : (
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

          {/* Hamburger menu (mobile) */}
         
        </Box>
      </Toolbar>

      {/* Mobile menu */}
      <Menu
        anchorEl={mobileAnchor}
        open={Boolean(mobileAnchor)}
        onClose={closeMobileMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        sx={{ display: { xs: "block", md: "none" } }}
      >
        {navConfig.map((item) => (
          <Box key={item.label}>
            <MenuItem disabled>{item.label}</MenuItem>
            {item.submenu.map((sub) => (
              <MenuItem
                key={sub.path}
                component={Link}
                to={sub.path}
                onClick={closeMobileMenu}
                sx={{ pl: 4 }}
              >
                {sub.label}
              </MenuItem>
            ))}
          </Box>
        ))}
        <Divider />
        <MenuItem component={Link} to="/contact" onClick={closeMobileMenu}>
          Liên hệ
        </MenuItem>

        {!userInfo && (
          <>
            <MenuItem component={Link} to="/login" onClick={closeMobileMenu}>
              <LoginIcon fontSize="small" sx={{ mr: 1 }} />
              Đăng nhập
            </MenuItem>
            <MenuItem component={Link} to="/register" onClick={closeMobileMenu}>
              <HowToRegIcon fontSize="small" sx={{ mr: 1 }} />
              Đăng ký
            </MenuItem>
          </>
        )}
      </Menu>
    </AppBar>
  );
};

export default Header;
