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

function lazyRoute(importer) {
  const LazyComponent = React.lazy(importer);

  return function LazyRouteComponent() {
    return (
      <React.Suspense fallback={null}>
        <LazyComponent />
      </React.Suspense>
    );
  };
}

const HomeScreen = lazyRoute(() => import("./screens/HomeScreen"));
const LoginScreen = lazyRoute(() => import("./screens/LoginScreen.jsx"));
const CheckpointScreen = lazyRoute(() =>
  import("./screens/CheckpointScreen.jsx"),
);
const RegisterScreen = lazyRoute(() => import("./screens/RegisterScreen.jsx"));
const ProfileScreen = lazyRoute(() => import("./screens/ProfileGate.jsx"));
const TournamentDashboard = lazyRoute(() =>
  import("./screens/TournamentsScreen.jsx"),
);
const TournamentRegistration = lazyRoute(() =>
  import("./screens/PickleBall/TournamentRegistration.jsx"),
);
const TournamentCheckin = lazyRoute(() =>
  import("./screens/PickleBall/TournamentCheckin.jsx"),
);
const TournamentBracket = lazyRoute(() =>
  import("./screens/PickleBall/TournamentBracket.jsx"),
);
const RankingList = lazyRoute(() =>
  import("./screens/RankingsScreen.jsx"),
);
const LevelPointPage = lazyRoute(() =>
  import("./screens/PickleBall/LevelPoint.jsx"),
);
const ContactPage = lazyRoute(() => import("./screens/ContactScreen.jsx"));
const CookiesPage = lazyRoute(() => import("./screens/CookiesPage.jsx"));
const PrivacyPage = lazyRoute(() => import("./screens/PrivacyPage.jsx"));
const TermsPage = lazyRoute(() => import("./screens/TermsPage.jsx"));
const StatusPage = lazyRoute(() => import("./screens/StatusPage.jsx"));
const ApiDocsPage = lazyRoute(() => import("./screens/ApiDocsPage.jsx"));
const SeoNewsListScreen = lazyRoute(() =>
  import("./screens/seo-news/SeoNewsListScreen.jsx"),
);
const SeoNewsDetailScreen = lazyRoute(() =>
  import("./screens/seo-news/SeoNewsDetailScreen.jsx"),
);
const BlogPostScreen = lazyRoute(() =>
  import("./screens/blog/BlogPostScreen.jsx"),
);
const ScoreOverlay = lazyRoute(() =>
  import("./screens/PickleBall/ScoreOverlay.jsx"),
);
const AdminDrawPage = lazyRoute(() =>
  import("./screens/PickleBall/AdminDrawPage.jsx"),
);
const DrawPage = lazyRoute(() => import("./screens/draw/DrawPage.jsx"));
const DrawLivePage = lazyRoute(() =>
  import("./screens/draw/DrawLivePage.jsx"),
);
const NotFound = lazyRoute(() => import("./screens/NotFound.jsx"));
const TournamentSchedule = lazyRoute(() =>
  import("./screens/PickleBall/TournamentSchedule.jsx"),
);
const TournamentManagePage = lazyRoute(() =>
  import("./screens/PickleBall/TournamentManagePage.jsx"),
);
const OverlayStudioPage = lazyRoute(() =>
  import("./screens/PickleBall/OverlayStudioPage.jsx"),
);
const TournamentOverviewPage = lazyRoute(() =>
  import("./screens/TournamentDetailScreen.jsx"),
);
const TournamentRefereePage = lazyRoute(() =>
  import("./screens/PickleBall/TournamentRefereePage.jsx"),
);
const MyTournamentsPage = lazyRoute(() =>
  import("./screens/MyTournamentsGate.jsx"),
);
const SupportCenterPage = lazyRoute(() => import("./screens/SupportGate.jsx"));
const ForgotPasswordScreen = lazyRoute(() =>
  import("./screens/ForgotPasswordScreen.jsx"),
);
const ResetPasswordScreen = lazyRoute(() =>
  import("./screens/ResetPasswordScreen.jsx"),
);
const OAuthAuthorizeScreen = lazyRoute(() =>
  import("./screens/OAuthAuthorizeScreen.jsx"),
);
const AdminLayout = lazyRoute(() => import("./components/AdminLayout.jsx"));
const UsersPage = lazyRoute(() => import("./screens/admin/UsersPage.jsx"));
const NewsPage = lazyRoute(() => import("./screens/admin/NewsPage.jsx"));
const AvatarOptimizationPage = lazyRoute(() =>
  import("./screens/admin/AvatarOptimizationPage.jsx"),
);
const ChatBotOpsPage = lazyRoute(() =>
  import("./screens/admin/ChatBotOpsPage.jsx"),
);
const IdentitySecurityPage = lazyRoute(() =>
  import("./screens/admin/IdentitySecurityPage.jsx"),
);
const AssessmentHistoryPage = lazyRoute(() =>
  import("./screens/admin/AssessmentHistoryPage.jsx"),
);
const Forbidden403 = lazyRoute(() => import("./screens/403.jsx"));
const ServiceUnavailable = lazyRoute(() => import("./screens/503.jsx"));
const PublicProfilePage = lazyRoute(() =>
  import("./screens/PublicProfilePage.jsx"),
);
const ClubsListPage = lazyRoute(() =>
  import("./screens/ClubsScreen.jsx"),
);
const ClubDetailPage = lazyRoute(() =>
  import("./components/ClubDetailPage.jsx"),
);
const CourtsBrowsePage = lazyRoute(() =>
  import("./screens/courts/CourtsBrowsePage.jsx"),
);
const VenueDetailPage = lazyRoute(() =>
  import("./screens/courts/VenueDetailPage.jsx"),
);
const MyBookingsPage = lazyRoute(() =>
  import("./screens/courts/MyBookingsPage.jsx"),
);
const OwnerVenuesPage = lazyRoute(() =>
  import("./screens/courts/owner/OwnerVenuesPage.jsx"),
);
const VenueEditorPage = lazyRoute(() =>
  import("./screens/courts/owner/VenueEditorPage.jsx"),
);
const VenueBookingsPage = lazyRoute(() =>
  import("./screens/courts/owner/VenueBookingsPage.jsx"),
);
const VenueRevenuePage = lazyRoute(() =>
  import("./screens/courts/owner/VenueRevenuePage.jsx"),
);
const LiveStudioPage = lazyRoute(() =>
  import("./screens/live/LiveStudioPage.jsx"),
);
const LiveFeedPage = lazyRoute(() => import("./screens/LiveScreen.jsx"));
const LiveCourtClustersPage = lazyRoute(() =>
  import("./screens/live/LiveCourtClustersPage.jsx"),
);
const CourtLiveStudioPage = lazyRoute(() =>
  import("./screens/live/CourtLiveStudio.jsx"),
);
const CourtStreamingPage = lazyRoute(() =>
  import("./screens/court-live/Courtstreamingpage.jsx"),
);
const FacebookLiveSettings = lazyRoute(() =>
  import("./components/FacebookLiveSettings"),
);

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
