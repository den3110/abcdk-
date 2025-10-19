import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Navigate,
  Route,
  RouterProvider,
} from "react-router-dom";
import "./index.css";
import "bootstrap/dist/css/bootstrap.min.css";
import store from "./store";
import { Provider } from "react-redux";
import HomeScreen from "./screens/HomeScreen";
import LoginScreen from "./screens/LoginScreen.jsx";
import RegisterScreen from "./screens/RegisterScreen.jsx";
import ProfileScreen from "./screens/ProfileScreen.jsx";
import PrivateRoute from "./components/PrivateRoute.jsx";
import TournamentDashboard from "./screens/PickleBall/Tournament.jsx";
import TournamentRegistration from "./screens/PickleBall/TournamentRegistration.jsx";
import TournamentCheckin from "./screens/PickleBall/TournamentCheckin.jsx";
import TournamentBracket from "./screens/PickleBall/TournamentBracket.jsx";
import RankingList from "./screens/PickleBall/RankingList.jsx";
import LevelPointPage from "./screens/PickleBall/LevelPoint.jsx";
import ContactPage from "./screens/Contact.jsx";
import { SocketProvider } from "./context/SocketContext.jsx";
import ScoreOverlay from "./screens/PickleBall/ScoreOverlay.jsx";
import AdminDrawPage from "./screens/PickleBall/AdminDrawPage.jsx";
import DrawPage from "./screens/draw/DrawPage.jsx";
import NotFound from "./screens/NotFound.jsx";
import TournamentSchedule from "./screens/PickleBall/TournamentSchedule.jsx";
import TournamentManagePage from "./screens/PickleBall/TournamentManagePage.jsx";
import TournamentOverviewPage from "./screens/PickleBall/TournamentOverviewPage.jsx";
import MyTournamentsPage from "./screens/MyTournaments.jsx";
import ForgotPasswordScreen from "./screens/ForgotPasswordScreen.jsx";
import ResetPasswordScreen from "./screens/ResetPasswordScreen.jsx";
import AdminLayout from "./components/AdminLayout.jsx";
import UsersPage from "./screens/admin/UsersPage.jsx";
import dayjs from "dayjs";
import "dayjs/locale/vi";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import "../index.css";
import Forbidden403 from "./screens/403.jsx";
import ServiceUnavailable from "./screens/503.jsx";
import PublicProfilePage from "./screens/PublicProfilePage.jsx";
import ClubsListPage from "./screens/clubs/ClubsListPage.jsx";
import ClubDetailPage from "./components/ClubDetailPage.jsx";
import LiveStudioPage from "./screens/live/LiveStudioPage.jsx";
import "@fontsource-variable/montserrat";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { theme } from "./theme.js";
import LiveMatchesPage from "./screens/live/LiveMatchesPage.jsx";

dayjs.locale("vi");

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/" element={<App />}>
        <Route index={true} path="/" element={<HomeScreen />} />
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/register" element={<RegisterScreen />} />
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
        <Route
          path="/tournament/:id/brackets/:bracketId/draw"
          element={<AdminDrawPage />}
        />
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
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/levelpoint" element={<LevelPointPage />} />
          <Route path="/my-tournaments" element={<MyTournamentsPage />} />
        </Route>
        <Route path="/clubs" element={<ClubsListPage />} />
        <Route path="/clubs/:id" element={<ClubDetailPage />} />
        <Route path="/live" element={<LiveMatchesPage />} />
      </Route>
      <Route path="/overlay/score" element={<ScoreOverlay />} />
      <Route path="/503" element={<ServiceUnavailable />} />
      <Route path="/studio/live" element={<LiveStudioPage />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
    </>
  )
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <Provider store={store}>
    <React.StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SocketProvider>
          <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="vi">
            <RouterProvider router={router} />
          </LocalizationProvider>
        </SocketProvider>
      </ThemeProvider>
    </React.StrictMode>
  </Provider>
);
