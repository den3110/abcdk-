import { Container } from "react-bootstrap";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { Outlet, useLocation } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import Header from "./components/Header";
import MobileBottomNav from "./components/MenuMobile";
import CheckpointRealtimeGate from "./components/CheckpointRealtimeGate.jsx";
import { Suspense, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { initGA, logPageView } from "./utils/analytics";
import { useThemeMode } from "./context/ThemeContext";
import { useCommandPalette } from "./context/CommandPaletteContext.jsx";
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
import useAstryxUi from "./hook/useAstryxUi.js";

import Clarity from "@microsoft/clarity";

import ChatBotDrawer from "./components/ChatBotDrawer";
import GlobalCommandPalette from "./components/GlobalCommandPalette";
const loadGlobalCommandPalette = () => Promise.resolve();

function CommandPaletteFallback() {
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 1600,
        display: "grid",
        placeItems: "center",
        bgcolor: "rgba(0,0,0,0.32)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
      }}
    >
      <CircularProgress size={32} />
    </Box>
  );
}

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
  const { open: commandPaletteOpen } = useCommandPalette();
  const { pikoraEnabled } = useFrontendUiVersion();
  const astryxUiOn = useAstryxUi();

  // Define routes that should have a full-screen layout (no header/footer)
  const isAuthPage = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/checkpoint",
    "/oauth/authorize",
  ].some((path) => location.pathname.startsWith(path));
  const isImmersiveLiveFeedPage = location.pathname === "/live";
  const isOverlayStudioPage = /\/tournament\/[^/]+\/overlay-studio$/.test(
    location.pathname,
  );
  const isTournamentBracketPage = /^\/tournament\/[^/]+\/bracket\/?$/.test(
    location.pathname,
  );
  // Các route đã refactor sang Astryx (full-bleed, tự có SiteNav — ẩn chrome global).
  // Bật/tắt theo cài đặt hệ thống frontendUi.version (Astryx = "v2") + override ?ui= — xem useAstryxUi.
  const ASTRYX_ROUTES = [
    "/",
    "/pickle-ball/tournaments",
    "/pickle-ball/rankings",
    "/clubs",
    "/contact",
    "/profile",
    "/my-tournaments",
    "/support",
  ];
  const astryxPath = location.pathname.replace(/\/+$/, "") || "/";
  const isAstryxHomeRoute =
    (ASTRYX_ROUTES.includes(astryxPath) ||
      /^\/tournament\/[^/]+$/.test(astryxPath) ||
      /^\/support\/[^/]+$/.test(astryxPath)) &&
    astryxUiOn;
  const isFullScreenLayout =
    isAuthPage ||
    isImmersiveLiveFeedPage ||
    isAstryxHomeRoute ||
    isOverlayStudioPage;
  const hideMobileBottomNav = isAstryxHomeRoute;
  const shouldShowPikora =
    pikoraEnabled &&
    !isAuthPage &&
    !isImmersiveLiveFeedPage &&
    !isAstryxHomeRoute &&
    !isOverlayStudioPage;

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
    if (typeof window === "undefined") return undefined;

    const preload = () => {
      void loadGlobalCommandPalette();
    };

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }

    const timer = window.setTimeout(preload, 1200);
    return () => window.clearTimeout(timer);
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
      <CheckpointRealtimeGate />
      <SentryRuntimeSync />
      <NativeWebViewAuthBridge />
      {!isFullScreenLayout && <Header />}
      <ToastContainer theme={isDark ? "dark" : "light"} />

      {isFullScreenLayout ? (
        <Outlet />
      ) : (
        <Container className="app-shell" fluid={isTournamentBracketPage}>
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

      {shouldShowPikora && (
        <Suspense fallback={null}>
          <ChatBotDrawer />
        </Suspense>
      )}
      {commandPaletteOpen ? (
        <Suspense fallback={<CommandPaletteFallback />}>
          <GlobalCommandPalette />
        </Suspense>
      ) : null}
    </>
  );
};

export default App;
