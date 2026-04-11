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
import SmartToyIcon from "@mui/icons-material/SmartToy";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import SEOHead from "../components/SEOHead";
import AppFooter from "../components/AppFooter";
import { useGetProfileQuery } from "../slices/usersApiSlice";
import { useLanguage } from "../context/LanguageContext.jsx";

const drawerWidth = 240;

function indexFromPath(pathname, navItems) {
  const idx = navItems.findIndex(
    (item) => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  return idx >= 0 ? idx : 0;
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isAdminUser(user) {
  const roles = new Set(
    Array.isArray(user?.roles) ? user.roles.map(normalizeRole) : [],
  );
  if (user?.role) roles.add(normalizeRole(user.role));
  if (user?.isAdmin === true) roles.add("admin");
  return roles.has("admin");
}

function isSuperAdminUser(user) {
  return (
    isAdminUser(user) &&
    (Boolean(user?.isSuperUser) || Boolean(user?.isSuperAdmin))
  );
}

export default function AdminLayout({ children }) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const isPhone = useMediaQuery(theme.breakpoints.down("sm"));
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

  const isAdmin = isAdminUser(userInfo);
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
    {
      label: tx("admin.layout.pikoraOps", "Pikora Bot Ops"),
      icon: <SmartToyIcon />,
      path: "/admin/pikora-ops",
    },
    ...(isSuperAdmin
      ? [
          {
            label: tx("admin.layout.avatarOptimization", "Tối ưu Ảnh Đại Diện"),
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
            <Toolbar
              variant="dense"
              sx={{ gap: isPhone ? 0.75 : 1, px: isPhone ? 0.75 : 1, minHeight: 56 }}
            >
              <Typography
                variant={isPhone ? "subtitle1" : "h6"}
                sx={{ flexShrink: 0, fontWeight: 700 }}
              >
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
                  allowScrollButtonsMobile
                  aria-label={t("admin.layout.navAria")}
                  sx={{
                    minHeight: 52,
                    "& .MuiTabs-scroller": { overflowY: "hidden" },
                    "& .MuiTabs-flexContainer": { gap: 0.25 },
                    "& .MuiTab-root": {
                      minWidth: isPhone ? 96 : 120,
                      minHeight: 52,
                      px: isPhone ? 1 : 1.5,
                      py: isPhone ? 0.5 : 0.75,
                      textTransform: "none",
                      fontSize: isPhone ? "0.72rem" : "0.8125rem",
                    },
                  }}
                >
                  {navItems.map((item) => (
                    <Tab
                      key={item.path}
                      icon={item.icon}
                      iconPosition="start"
                      label={item.label}
                      wrapped={isPhone}
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
              p: { xs: 1.5, sm: 2 },
              mt: { xs: 9.5, sm: 10 },
              minHeight: "calc(100dvh - 80px)",
              minWidth: 0,
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
