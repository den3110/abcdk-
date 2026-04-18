import { Container } from "react-bootstrap";
import Box from "@mui/material/Box";
import { Outlet, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Header from "./components/Header";
import MobileBottomNav from "./components/MenuMobile";
import ChatBotDrawer from "./components/ChatBotDrawer";
import GlobalCommandPalette from "./components/GlobalCommandPalette";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { initGA, logPageView } from "./utils/analytics";
import { useThemeMode } from "./context/ThemeContext";
import { useGetProfileQuery } from "./slices/usersApiSlice";
import AppFooter from "./components/AppFooter";
import { logout, setCredentials } from "./slices/authSlice";
import {
  addSentryNavigationBreadcrumb,
  clearSentryUserContext,
  setSentryUserContext,
} from "./utils/sentry";
import {
  closeCrossTabChannel,
  createCrossTabChannel,
  publishCrossTabMessage,
  subscribeCrossTabChannel,
} from "./utils/crossTabChannel";
import useFrontendUiVersion from "./hook/useFrontendUiVersion.js";

import Clarity from "@microsoft/clarity";

function shouldEnableClarity() {
  if (typeof window === "undefined") return false;
  const host = String(window.location.hostname || "").toLowerCase();
  const isLocalhost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
  return !isLocalhost && !import.meta.env.DEV;
}

const AUTH_SYNC_CHANNEL = "pickletour:auth";
const AUTH_SYNC_TOPIC = "user-info";

function readStoredAuthUserInfo() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem("userInfo");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function AuthSessionSync() {
  const dispatch = useDispatch();
  const userInfo = useSelector((s) => s.auth?.userInfo || null);
  const isLoggedIn = Boolean(
    userInfo?._id || userInfo?.token || userInfo?.email,
  );
  const serializedUserInfo = JSON.stringify(userInfo || null);
  const currentSerializedRef = useRef(serializedUserInfo);
  const syncChannelRef = useRef(null);

  // Keep userInfo (role/permissions) fresh without forcing re-login.
  useGetProfileQuery(undefined, {
    skip: !isLoggedIn,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    currentSerializedRef.current = serializedUserInfo;
  }, [serializedUserInfo]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const applySerializedUserInfo = (serialized) => {
      const normalized = serialized || "null";
      if (normalized === currentSerializedRef.current) return;

      if (normalized === "null") {
        dispatch(logout());
        return;
      }

      try {
        const parsed = JSON.parse(normalized);
        if (!parsed || typeof parsed !== "object") {
          dispatch(logout());
          return;
        }
        dispatch(setCredentials(parsed));
      } catch {
        dispatch(logout());
      }
    };

    const handleStorage = (event) => {
      if (event.key !== "userInfo" && event.key !== null) return;

      if (event.key === null) {
        applySerializedUserInfo(JSON.stringify(readStoredAuthUserInfo()));
        return;
      }

      applySerializedUserInfo(event.newValue || "null");
    };

    const channel = createCrossTabChannel(AUTH_SYNC_CHANNEL);
    syncChannelRef.current = channel;
    const unsubscribe = subscribeCrossTabChannel(channel, (message) => {
      if (message?.topic !== AUTH_SYNC_TOPIC) return;
      applySerializedUserInfo(String(message?.serialized ?? "null"));
    });

    window.addEventListener("storage", handleStorage);
    return () => {
      unsubscribe();
      closeCrossTabChannel(channel);
      if (syncChannelRef.current === channel) {
        syncChannelRef.current = null;
      }
      window.removeEventListener("storage", handleStorage);
    };
  }, [dispatch]);

  useEffect(() => {
    publishCrossTabMessage(syncChannelRef.current, {
      topic: AUTH_SYNC_TOPIC,
      serialized: serializedUserInfo,
    });
  }, [serializedUserInfo]);

  return null;
}

function SentryRuntimeSync() {
  const location = useLocation();
  const userInfo = useSelector((s) => s.auth?.userInfo || null);
  const rolesKey = Array.isArray(userInfo?.roles)
    ? userInfo.roles.join("|")
    : "";

  useEffect(() => {
    if (userInfo?._id || userInfo?.id || userInfo?.email) {
      setSentryUserContext(userInfo);
      return;
    }

    clearSentryUserContext();
  }, [
    userInfo?._id,
    userInfo?.id,
    userInfo?.email,
    userInfo?.name,
    userInfo?.nickname,
    userInfo?.role,
    userInfo?.isAdmin,
    userInfo?.isSuperAdmin,
    userInfo?.isSuperUser,
    rolesKey,
    userInfo,
  ]);

  useEffect(() => {
    addSentryNavigationBreadcrumb(location);
  }, [location.pathname, location.search, location.hash, location]);

  return null;
}

function isReactNativeWebViewRuntime() {
  return (
    typeof window !== "undefined" &&
    typeof window.ReactNativeWebView?.postMessage === "function"
  );
}

function NativeWebViewAuthBridge() {
  const dispatch = useDispatch();
  const userInfo = useSelector((s) => s.auth?.userInfo || null);
  const lastPostedRef = useRef("");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleNativeAuthSync = (event) => {
      const nextUserInfo =
        event?.detail && typeof event.detail === "object"
          ? event.detail.userInfo || null
          : null;

      const currentSerialized = JSON.stringify(userInfo || null);
      const nextSerialized = JSON.stringify(nextUserInfo || null);
      if (currentSerialized === nextSerialized) return;

      if (nextUserInfo && typeof nextUserInfo === "object") {
        dispatch(setCredentials(nextUserInfo));
        return;
      }

      dispatch(logout());
    };

    window.addEventListener("pickletour:native-auth-sync", handleNativeAuthSync);
    return () =>
      window.removeEventListener(
        "pickletour:native-auth-sync",
        handleNativeAuthSync,
      );
  }, [dispatch, userInfo]);

  useEffect(() => {
    if (!isReactNativeWebViewRuntime()) return;

    const serialized = JSON.stringify(userInfo || null);
    if (lastPostedRef.current === serialized) return;
    lastPostedRef.current = serialized;

    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        source: "pickletour-web",
        type: "auth-state",
        payload: {
          userInfo: userInfo || null,
        },
      }),
    );
  }, [userInfo]);

  return null;
}

const App = () => {
  const location = useLocation();
  const { isDark } = useThemeMode();
  const { isModernVersion } = useFrontendUiVersion();

  // Define routes that should have a full-screen layout (no header/footer)
  const isAuthPage = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/oauth/authorize",
  ].some((path) => location.pathname.startsWith(path));
  const isImmersiveLiveFeedPage = location.pathname === "/live";
  const hideMobileBottomNav = isModernVersion && location.pathname === "/";

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

    if (projectId && shouldEnableClarity()) {
      Clarity.init(projectId);
    }
  }, []);

  useEffect(() => {
    // Track mỗi lần đổi page (GA)
    logPageView(location.pathname + location.search, document.title);

    // ✅ Track/Tag cho Clarity mỗi lần đổi route (SPA)
    if (shouldEnableClarity() && typeof window.clarity === "function") {
      const url = location.pathname + location.search;

      window.clarity("set", "route", location.pathname);
      window.clarity("set", "url", url);
      window.clarity("event", "pageview");
    }
  }, [location]);

  return (
    <>
      <AuthSessionSync />
      <SentryRuntimeSync />
      <NativeWebViewAuthBridge />
      {!isAuthPage && !isImmersiveLiveFeedPage && <Header />}
      <ToastContainer theme={isDark ? "dark" : "light"} />

      {isAuthPage || isImmersiveLiveFeedPage ? (
        <Outlet />
      ) : (
        <Container className="app-shell">
          <Box
            component="main"
            sx={{
              minHeight: {
                xs: "calc(100dvh - 56px)",
                md: "calc(100vh - 88px)",
              },
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
          {!hideMobileBottomNav ? <MobileBottomNav /> : null}
          {/* <RegInvitesModal /> */}
        </Container>
      )}

      {!isAuthPage && !isImmersiveLiveFeedPage && <ChatBotDrawer />}
      <GlobalCommandPalette />
    </>
  );
};

export default App;
