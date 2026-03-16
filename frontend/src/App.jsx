import { Container } from "react-bootstrap";
import Box from "@mui/material/Box";
import { Outlet, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Header from "./components/Header";
import MobileBottomNav from "./components/MenuMobile";
import ChatBotDrawer from "./components/ChatBotDrawer";
import { useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { initGA, logPageView } from "./utils/analytics";
import { useThemeMode } from "./context/ThemeContext";
import { useGetProfileQuery } from "./slices/usersApiSlice";
import AppFooter from "./components/AppFooter";

import Clarity from "@microsoft/clarity";

function AuthSessionSync() {
  const userInfo = useSelector((s) => s.auth?.userInfo || null);
  const isLoggedIn = Boolean(
    userInfo?._id || userInfo?.token || userInfo?.email,
  );

  // Keep userInfo (role/permissions) fresh without forcing re-login.
  useGetProfileQuery(undefined, {
    skip: !isLoggedIn,
    pollingInterval: 60 * 1000,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  return null;
}

const App = () => {
  const location = useLocation();
  const { isDark } = useThemeMode();

  // Define routes that should have a full-screen layout (no header/footer)
  const isAuthPage = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ].some((path) => location.pathname.startsWith(path));

  // ✅ tránh init 2 lần (React 18 StrictMode dev)
  const clarityInitedRef = useRef(false);

  useEffect(() => {
    // Khởi tạo GA4 khi app load
    initGA();

    // ✅ Init Clarity 1 lần
    if (clarityInitedRef.current) return;
    clarityInitedRef.current = true;

    // TODO: set 1 trong các env này tùy dự án bạn:
    // - CRA: REACT_APP_CLARITY_PROJECT_ID
    // - Vite: VITE_CLARITY_PROJECT_ID
    const projectId =
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_CLARITY_PROJECT_ID) ||
      "";

    if (typeof window !== "undefined" && projectId) {
      Clarity.init(projectId);
    }
  }, []);

  useEffect(() => {
    // Track mỗi lần đổi page (GA)
    logPageView(location.pathname + location.search, document.title);

    // ✅ Track/Tag cho Clarity mỗi lần đổi route (SPA)
    if (typeof window !== "undefined" && typeof window.clarity === "function") {
      const url = location.pathname + location.search;

      window.clarity("set", "route", location.pathname);
      window.clarity("set", "url", url);
      window.clarity("event", "pageview");
    }
  }, [location]);

  return (
    <>
      <AuthSessionSync />
      {!isAuthPage && <Header />}
      <ToastContainer theme={isDark ? "dark" : "light"} />

      {isAuthPage ? (
        /* Auth pages: Full screen, no container constraints */
        <Outlet />
      ) : (
        /* Normal pages: keep desktop shell, trim mobile gutters */
        <Container className="app-shell">
          <Box
            component="main"
            sx={{
              minHeight: { xs: "calc(100dvh - 56px)", md: "calc(100vh - 88px)" },
              display: "flex",
              flexDirection: "column",
              pb: { xs: 10, md: 0 },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Outlet />
            </Box>
            <AppFooter />
          </Box>
          <MobileBottomNav />
          {/* <RegInvitesModal /> */}
        </Container>
      )}

      {!isAuthPage && <ChatBotDrawer />}
    </>
  );
};

export default App;
