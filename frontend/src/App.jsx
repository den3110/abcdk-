import { Container } from "react-bootstrap";
import { Outlet, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Header from "./components/Header";
import MobileBottomNav from "./components/MenuMobile";
import RegInvitesModal from "./components/RegInvitesModal";
import ChatBotDrawer from "./components/ChatBotDrawer";
import { useEffect, useRef } from "react";
import { initGA, logPageView } from "./utils/analytics";
import { useThemeMode } from "./context/ThemeContext";

import Clarity from "@microsoft/clarity";

const App = () => {
  const location = useLocation();
  const { isDark } = useThemeMode();

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
      <Header />
      <ToastContainer theme={isDark ? "dark" : "light"} />
      <Container className="" style={{ marginBottom: "80px" }}>
        <Outlet />
        <MobileBottomNav />
        {/* <RegInvitesModal /> */}
      </Container>
      <ChatBotDrawer />
    </>
  );
};

export default App;
