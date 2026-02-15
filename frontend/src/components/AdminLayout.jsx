// src/layouts/AdminLayout.jsx
import { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  useTheme,
  useMediaQuery,
  Button,
  Badge,
} from "@mui/material";
import SEOHead from "../components/SEOHead";
import PeopleIcon from "@mui/icons-material/People";
import HomeIcon from "@mui/icons-material/Home";
import { useLocation, useNavigate, Outlet, Navigate } from "react-router-dom"; // ✅ thêm Navigate
import { useTheme } from "@mui/material/styles";
import { useSelector } from "react-redux"; // ✅ lấy userInfo từ redux

const drawerWidth = 240;

const navItems = [
  { label: "Quản lý user", icon: <PeopleIcon />, path: "/admin/users" },
];

function indexFromPath(pathname) {
  const idx = navItems.findIndex(
    (i) => pathname === i.path || pathname.startsWith(i.path + "/")
  );
  return idx >= 0 ? idx : 0;
}

export default function AdminLayout({ children }) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const location = useLocation();
  const navigate = useNavigate();

  // ✅ lấy quyền admin từ redux
  const { userInfo } = useSelector((s) => s.auth || {});
  const isAdmin = userInfo?.role === "admin" || userInfo?.isAdmin === true;

  // ✅ nếu không phải admin -> đẩy ra 403
  if (!isAdmin) {
    return <Navigate to="/403" replace state={{ from: location }} />;
  }

  const current = indexFromPath(location.pathname);

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ px: 2, py: 2 }}>
        <Typography variant="h6" noWrap>
          Admin
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Bảng điều khiển
        </Typography>
      </Box>

      <List sx={{ mt: 1 }}>
        {navItems.map((item, idx) => (
          <ListItemButton
            key={item.path}
            selected={current === idx}
            onClick={() => navigate(item.path)}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText
              primary={item.label}
              primaryTypographyProps={{ noWrap: true }}
            />
          </ListItemButton>
        ))}
      </List>

      <Box sx={{ flexGrow: 1 }} />
      <Box sx={{ p: 2 }}>
        <Button fullWidth variant="outlined" onClick={() => navigate("/")}>
          Về trang chủ
        </Button>
      </Box>
    </Box>
  );



  return (
    <Box
      sx={{
        display: "flex",
        minHeight: "100vh",
        bgcolor: "background.default",
      }}
    >
      <SEOHead title="Quản trị hệ thống" noIndex={true} />
      {isDesktop ? (
        <>
          <Drawer
            variant="permanent"
            open
            sx={{
              width: drawerWidth,
              flexShrink: 0,
              "& .MuiDrawer-paper": {
                width: drawerWidth,
                boxSizing: "border-box",
              },
            }}
          >
            {drawer}
          </Drawer>

          <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, md: 3 } }}>
            {children ?? <Outlet />}
          </Box>
        </>
      ) : (
        <>
          <AppBar position="fixed" color="inherit" elevation={1}>
            <Toolbar variant="dense" sx={{ gap: 1, px: 1 }}>
              <Typography variant="h6" sx={{ flexShrink: 0 }}>
                Admin
              </Typography>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Tabs
                  value={current}
                  onChange={(_, v) => navigate(navItems[v].path)}
                  variant="scrollable"
                  scrollButtons="auto"
                  aria-label="Điều hướng admin"
                  sx={{
                    "& .MuiTab-root": { minWidth: 120, textTransform: "none" },
                  }}
                >
                  {navItems.map((item) => (
                    <Tab
                      key={item.path}
                      icon={item.icon}
                      iconPosition="start"
                      label={item.label}
                    />
                  ))}
                </Tabs>
              </Box>

              <Tooltip title="Về trang chủ">
                <IconButton
                  edge="end"
                  size="small"
                  aria-label="Về trang chủ"
                  onClick={() => navigate("/")}
                >
                  <HomeIcon />
                </IconButton>
              </Tooltip>
            </Toolbar>
          </AppBar>

          <Box component="main" sx={{ p: 2, mt: 10 }}>
            {children ?? <Outlet />}
          </Box>
        </>
      )}
    </Box>
  );
}
