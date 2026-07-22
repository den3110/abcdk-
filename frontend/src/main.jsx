import React from "react";
import { HelmetProvider } from "react-helmet-async";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import {
  createBrowserRouter,
  createRoutesFromChildren,
  createRoutesFromElements,
  matchRoutes,
  Navigate,
  Route,
  RouterProvider,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import "./index.css";
import "bootstrap/dist/css/bootstrap.min.css";
import store from "./store";
import { Provider } from "react-redux";
import PrivateRoute from "./components/PrivateRoute.jsx";
import { SocketProvider } from "./context/SocketContext.jsx";
// import "../index.css"; // REMOVED: Moved to src/index.css
import "@fontsource-variable/montserrat";
import { ThemeContextProvider } from "./context/ThemeContext.jsx";
import { LanguageContextProvider } from "./context/LanguageContext.jsx";
import { CommandPaletteProvider } from "./context/CommandPaletteContext.jsx";
import { ChatBotPageContextProvider } from "./context/ChatBotPageContext.jsx";
import AppInitGate from "./components/AppInitGate.jsx";
import LocalizedDateProvider from "./components/LocalizedDateProvider.jsx";
import SentryRootFallback from "./components/SentryRootFallback.jsx";
import { initSentry } from "./utils/sentry.js";
// OTP tạm tắt
// import RegisterOtpScreen from "./screens/RegisterOtpScreen.jsx";
// import VerifyOtpScreen from "./screens/VerifyOtpScreen.jsx";

import HomeScreen from "./screens/HomeScreen";
import LoginScreen from "./screens/LoginScreen.jsx";
import CheckpointScreen from "./screens/CheckpointScreen.jsx";
import RegisterScreen from "./screens/RegisterScreen.jsx";
import ProfileScreen from "./screens/ProfileGate.jsx";
import TournamentDashboard from "./screens/TournamentsScreen.jsx";
import TournamentRegistration from "./screens/PickleBall/TournamentRegistration.jsx";
import TournamentCheckin from "./screens/PickleBall/TournamentCheckin.jsx";
import TournamentBracket from "./screens/PickleBall/TournamentBracket.jsx";
import RankingList from "./screens/RankingsScreen.jsx";
import LevelPointPage from "./screens/PickleBall/LevelPoint.jsx";
import ContactPage from "./screens/ContactScreen.jsx";
import CookiesPage from "./screens/CookiesPage.jsx";
import PrivacyPage from "./screens/PrivacyPage.jsx";
import TermsPage from "./screens/TermsPage.jsx";
import StatusPage from "./screens/StatusPage.jsx";
import ApiDocsPage from "./screens/ApiDocsPage.jsx";
import SeoNewsListScreen from "./screens/seo-news/SeoNewsListScreen.jsx";
import SeoNewsDetailScreen from "./screens/seo-news/SeoNewsDetailScreen.jsx";
import BlogPostScreen from "./screens/blog/BlogPostScreen.jsx";
import ScoreOverlay from "./screens/PickleBall/ScoreOverlay.jsx";
import AdminDrawPage from "./screens/PickleBall/AdminDrawPage.jsx";
import DrawPage from "./screens/draw/DrawPage.jsx";
import DrawLivePage from "./screens/draw/DrawLivePage.jsx";
import NotFound from "./screens/NotFound.jsx";
import TournamentSchedule from "./screens/PickleBall/TournamentSchedule.jsx";
import TournamentManagePage from "./screens/PickleBall/TournamentManagePage.jsx";
import OverlayStudioPage from "./screens/PickleBall/OverlayStudioPage.jsx";
import TournamentOverviewPage from "./screens/TournamentDetailScreen.jsx";
import TournamentRefereePage from "./screens/PickleBall/TournamentRefereePage.jsx";
import MyTournamentsPage from "./screens/MyTournamentsGate.jsx";
import SupportCenterPage from "./screens/SupportGate.jsx";
import ForgotPasswordScreen from "./screens/ForgotPasswordScreen.jsx";
import ResetPasswordScreen from "./screens/ResetPasswordScreen.jsx";
import OAuthAuthorizeScreen from "./screens/OAuthAuthorizeScreen.jsx";
import AdminLayout from "./components/AdminLayout.jsx";
import UsersPage from "./screens/admin/UsersPage.jsx";
import NewsPage from "./screens/admin/NewsPage.jsx";
import AvatarOptimizationPage from "./screens/admin/AvatarOptimizationPage.jsx";
import ChatBotOpsPage from "./screens/admin/ChatBotOpsPage.jsx";
import IdentitySecurityPage from "./screens/admin/IdentitySecurityPage.jsx";
import AssessmentHistoryPage from "./screens/admin/AssessmentHistoryPage.jsx";
import Forbidden403 from "./screens/403.jsx";
import ServiceUnavailable from "./screens/503.jsx";
import PublicProfilePage from "./screens/PublicProfilePage.jsx";
import ClubsListPage from "./screens/ClubsScreen.jsx";
import ClubDetailPage from "./components/ClubDetailPage.jsx";
import CourtsBrowsePage from "./screens/courts/CourtsBrowsePage.jsx";
import VenueDetailPage from "./screens/courts/VenueDetailPage.jsx";
import MyBookingsPage from "./screens/courts/MyBookingsPage.jsx";
import OwnerVenuesPage from "./screens/courts/owner/OwnerVenuesPage.jsx";
import VenueEditorPage from "./screens/courts/owner/VenueEditorPage.jsx";
import VenueBookingsPage from "./screens/courts/owner/VenueBookingsPage.jsx";
import VenueRevenuePage from "./screens/courts/owner/VenueRevenuePage.jsx";
import LiveStudioPage from "./screens/live/LiveStudioPage.jsx";
import LiveFeedPage from "./screens/LiveScreen.jsx";
import LiveWatchPage from "./screens/live/LiveWatchPage.jsx";
import LiveCourtClustersPage from "./screens/live/LiveCourtClustersPage.jsx";
import CourtLiveStudioPage from "./screens/live/CourtLiveStudio.jsx";
import CourtStreamingPage from "./screens/court-live/Courtstreamingpage.jsx";
import FacebookLiveSettings from "./components/FacebookLiveSettings";

if (import.meta.env.PROD && typeof window !== "undefined") {
  let reloadingForSwUpdate = false;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateSW(true);
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      window.setInterval(() => {
        if (!navigator.onLine) return;
        registration.update().catch(() => {});
      }, 60_000);
    },
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForSwUpdate) return;
      reloadingForSwUpdate = true;
      window.location.reload();
    });
  }
}

initSentry({
  routerTracingIntegration: Sentry.reactRouterV6BrowserTracingIntegration({
    useEffect: React.useEffect,
    useLocation,
    useNavigationType,
    createRoutesFromChildren,
    matchRoutes,
  }),
});

const sentryCreateBrowserRouter =
  Sentry.wrapCreateBrowserRouterV6(createBrowserRouter);

const router = sentryCreateBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<App />}>
        <Route index={true} path="/" element={<HomeScreen />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/checkpoint" element={<CheckpointScreen />} />
        <Route path="/oauth/authorize" element={<OAuthAuthorizeScreen />} />
        {/* OTP tạm tắt */}
        {/* <Route path="/verify-otp" element={<VerifyOtpScreen />} /> */}
        <Route path="/register" element={<RegisterScreen />} />
        {/* <Route path="/register/otp" element={<RegisterOtpScreen />} /> */}
        <Route
          path="/pickle-ball/tournaments"
          element={<TournamentDashboard />}
        />
        <Route
          path="/tournament/:id/register"
          element={<TournamentRegistration />}
        />
        <Route path="/tournament/:id/checkin" element={<TournamentCheckin />} />
        <Route path="/tournament/:id/bracket" element={<TournamentBracket />} />
        <Route
          path="/tournament/:id/schedule"
          element={<TournamentSchedule />}
        />
        <Route path="/pickle-ball/rankings" element={<RankingList />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/cookies" element={<CookiesPage />} />
        <Route path="/privacy-and-policy" element={<PrivacyPage />} />
        <Route path="/terms-of-service" element={<TermsPage />} />
        <Route path="/privacy" element={<Navigate to="/privacy-and-policy" replace />} />
        <Route path="/terms" element={<Navigate to="/terms-of-service" replace />} />
        <Route path="/news" element={<SeoNewsListScreen />} />
        <Route path="/news/:slug" element={<SeoNewsDetailScreen />} />
        <Route path="/blog/:slug" element={<BlogPostScreen />} />
        <Route
          path="/tournament/:id/brackets/:bracketId/draw"
          element={<AdminDrawPage />}
        />
        <Route path="/tournament/:id/draw/live" element={<DrawLivePage />} />
        <Route
          path="/tournament/:id/overview"
          element={<TournamentOverviewPage />}
        />
        <Route path="/tournament/:id" element={<TournamentOverviewPage />} />

        <Route path="/404" element={<NotFound />} />
        <Route path="/403" element={<Forbidden403 />} />
        <Route path="*" element={<NotFound />} />
        <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
        <Route
          path="/reset-password/:token"
          element={<ResetPasswordScreen />}
        />
        <Route path="/user/:id" element={<PublicProfilePage />} />
        <Route path="" element={<PrivateRoute />}>
          <Route path="/tournament/:id/draw" element={<DrawPage />} />
          <Route
            path="/tournament/:id/manage"
            element={<TournamentManagePage />}
          />
          <Route
            path="/tournament/:id/overlay-studio"
            element={<OverlayStudioPage />}
          />
          <Route
            path="/tournament/:id/referee"
            element={<TournamentRefereePage />}
          />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/levelpoint" element={<LevelPointPage />} />
          <Route path="/my-tournaments" element={<MyTournamentsPage />} />
          <Route path="/support" element={<SupportCenterPage />} />
          <Route path="/support/:id" element={<SupportCenterPage />} />
          <Route path="/my-bookings" element={<MyBookingsPage />} />
          <Route path="/owner/venues" element={<OwnerVenuesPage />} />
          <Route path="/owner/venues/:id" element={<VenueEditorPage />} />
          <Route
            path="/owner/venues/:id/bookings"
            element={<VenueBookingsPage />}
          />
          <Route
            path="/owner/venues/:id/revenue"
            element={<VenueRevenuePage />}
          />
        </Route>
        <Route path="/clubs" element={<ClubsListPage />} />
        <Route path="/clubs/:id" element={<ClubDetailPage />} />
        <Route path="/courts" element={<CourtsBrowsePage />} />
        <Route path="/courts/:id" element={<VenueDetailPage />} />
        <Route path="/live/watch/:matchId" element={<LiveWatchPage />} />
        <Route path="/live" element={<LiveFeedPage />} />
        <Route path="/live/clusters" element={<LiveCourtClustersPage />} />
        <Route path="/settings/facebook" element={<FacebookLiveSettings />} />
      </Route>
      <Route path="/docs" element={<Navigate to="/docs/api" replace />} />
      <Route path="/docs/api" element={<ApiDocsPage />} />
      <Route path="/overlay/score" element={<ScoreOverlay />} />
      <Route path="/503" element={<ServiceUnavailable />} />
      <Route path="/studio/live" element={<LiveStudioPage />} />
      <Route path="/streaming/:courtId" element={<CourtStreamingPage />} />
      <Route
        path="/live/:tid/brackets/:bid/live-studio/:courtId"
        element={<CourtLiveStudioPage />}
      />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="identity-security" element={<IdentitySecurityPage />} />
        <Route path="assessment-history" element={<AssessmentHistoryPage />} />
        <Route path="news" element={<NewsPage />} />
        <Route path="pikora-ops" element={<ChatBotOpsPage />} />
        <Route
          path="avatar-optimization"
          element={<AvatarOptimizationPage />}
        />
      </Route>
    </>,
  ),
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <Sentry.ErrorBoundary fallback={<SentryRootFallback />} showDialog={false}>
    <Provider store={store}>
      <React.StrictMode>
        <HelmetProvider>
          <ThemeContextProvider>
            <LanguageContextProvider>
              <ChatBotPageContextProvider>
                <CommandPaletteProvider>
                  <AppInitGate>
                    <SocketProvider>
                      <LocalizedDateProvider>
                        <RouterProvider router={router} />
                      </LocalizedDateProvider>
                    </SocketProvider>
                  </AppInitGate>
                </CommandPaletteProvider>
              </ChatBotPageContextProvider>
            </LanguageContextProvider>
          </ThemeContextProvider>
        </HelmetProvider>
      </React.StrictMode>
    </Provider>
  </Sentry.ErrorBoundary>,
);
