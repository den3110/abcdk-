import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import {
  createBrowserRouter,
  createRoutesFromElements,
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
        <Route path="/pickle-ball/rankings" element={<RankingList />} />
        <Route path="/contact" element={<ContactPage />} />

        <Route path="" element={<PrivateRoute />}>
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/levelpoint" element={<LevelPointPage />} />
        </Route>
      </Route>
      <Route path="/overlay/score" element={<ScoreOverlay />} />
    </>
  )
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <Provider store={store}>
    <React.StrictMode>
      <SocketProvider>
        <RouterProvider router={router} />
      </SocketProvider>
    </React.StrictMode>
  </Provider>
);
