import PropTypes from "prop-types";
import {
  AppBar,
  Box,
  Button,
  CircularProgress,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import PeopleIcon from "@mui/icons-material/People";
import HomeIcon from "@mui/icons-material/Home";
import ArticleIcon from "@mui/icons-material/Article";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import SEOHead from "../components/SEOHead";
import AppFooter from "../components/AppFooter";
import { useGetProfileQuery } from "../slices/usersApiSlice";
import { useLanguage } from "../context/LanguageContext.jsx";

const drawerWidth = 240;

function indexFromPath(pathname, navItems) {
  const idx = navItems.findIndex(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`)
  );
  return idx >= 0 ? idx : 0;
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isSuperAdminUser(user) {
  const roles = new Set(
    Array.isArray(user?.roles) ? user.roles.map(normalizeRole) : []
  );
  if (user?.role) roles.add(normalizeRole(user.role));
  if (user?.isAdmin === true) roles.add("admin");
  if (user?.isSuperUser || user?.isSuperAdmin) {
    roles.add("admin");
    roles.add("superadmin");
    roles.add("superuser");
  }
  return roles.has("admin") && (roles.has("superadmin") || roles.has("superuser"));
}

export default function AdminLayout({ children }) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const tx = (key, fallback) => {
    const value = t(key);
    return value === key ? fallback : value;
  };
  const { userInfo } = useSelector((state) => state.auth || {});
  const { isLoading: syncingProfile } = useGetProfileQuery(undefined, {
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const isAdmin = userInfo?.role === "admin" || userInfo?.isAdmin === true;
  const isSuperAdmin = isSuperAdminUser(userInfo);

  const navItems = [
    {
      label: t("admin.layout.users"),
      icon: <PeopleIcon />,
      path: "/admin/users",
    },
    {
      label: t("admin.layout.news"),
      icon: <ArticleIcon />,
      path: "/admin/news",
    },
    ...(isSuperAdmin
      ? [
          {
            label: tx("admin.layout.avatarOptimization", "Avatar optimize"),
            icon: <AutoFixHighIcon />,
            path: "/admin/avatar-optimization",
          },
        ]
      : []),
  ];

  if (syncingProfile && !isAdmin) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress size={28} />
      </Box>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/403" replace state={{ from: location }} />;
  }

  const current = indexFromPath(location.pathname, navItems);

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ px: 2, py: 2 }}>
        <Typography variant="h6" noWrap>
          {t("admin.layout.title")}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t("admin.layout.subtitle")}
        </Typography>
      </Box>

      <List sx={{ mt: 1 }}>
        {navItems.map((item, idx) => (
          <ListItemButton
            key={item.path}
            selected={current === idx}
            onClick={() => {
              navigate(item.path);
              window.scrollTo(0, 0);
            }}
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
        <Button
          fullWidth
          variant="outlined"
          onClick={() => {
            navigate("/");
            window.scrollTo(0, 0);
          }}
        >
          {t("admin.layout.backHome")}
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
      <SEOHead title={t("admin.layout.seoTitle")} noIndex={true} />
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

          <Box
            component="main"
            sx={{
              flexGrow: 1,
              minWidth: 0,
              p: { xs: 1.5, md: 3 },
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>{children ?? <Outlet />}</Box>
            <AppFooter />
          </Box>
        </>
      ) : (
        <>
          <AppBar position="fixed" color="inherit" elevation={1}>
            <Toolbar variant="dense" sx={{ gap: 1, px: 1 }}>
              <Typography variant="h6" sx={{ flexShrink: 0 }}>
                {t("admin.layout.title")}
              </Typography>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Tabs
                  value={current}
                  onChange={(_, value) => {
                    navigate(navItems[value].path);
                    window.scrollTo(0, 0);
                  }}
                  variant="scrollable"
                  scrollButtons="auto"
                  aria-label={t("admin.layout.navAria")}
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

              <Tooltip title={t("admin.layout.backHome")}>
                <IconButton
                  edge="end"
                  size="small"
                  aria-label={t("admin.layout.backHome")}
                  onClick={() => {
                    navigate("/");
                    window.scrollTo(0, 0);
                  }}
                >
                  <HomeIcon />
                </IconButton>
              </Tooltip>
            </Toolbar>
          </AppBar>

          <Box
            component="main"
            sx={{
              p: 2,
              mt: 10,
              minHeight: "calc(100dvh - 80px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>{children ?? <Outlet />}</Box>
            <AppFooter />
          </Box>
        </>
      )}
    </Box>
  );
}

AdminLayout.propTypes = {
  children: PropTypes.node,
};
