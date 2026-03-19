// src/slices/apiSlice.js
import { fetchBaseQuery, createApi } from "@reduxjs/toolkit/query/react";
import { logout } from "./authSlice";
import { createListenerMiddleware } from "@reduxjs/toolkit";

const generateRequestId = () => {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch (e) {
    console.log("Cannot use crypto.randomUUID", e);
  }

  return `req_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
};

const rawBaseQuery = fetchBaseQuery({
  baseUrl: import.meta.env.VITE_API_URL,
  credentials: "include",
  prepareHeaders: (headers, { getState }) => {
    try {
      const requestId = generateRequestId();
      if (requestId) {
        headers.set("X-Request-Id", requestId);
      }
    } catch (e) {
      console.log("Cannot set X-Request-Id", e);
    }
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) {
        headers.set("X-Timezone", tz);
      }

      const offsetMinutes = new Date().getTimezoneOffset();
      headers.set("X-Timezone-Offset", String(offsetMinutes));

      const offsetHoursFloat = -offsetMinutes / 60;
      const sign = offsetHoursFloat >= 0 ? "+" : "-";
      const absTotalMinutes = Math.abs(offsetMinutes);
      const absHours = Math.floor(absTotalMinutes / 60);
      const absMinutes = absTotalMinutes % 60;

      const pad = (n) => String(n).padStart(2, "0");
      const gmt = `GMT${sign}${pad(absHours)}:${pad(absMinutes)}`;

      headers.set("X-Timezone-Gmt", gmt);
    } catch (e) {
      console.log("Cannot resolve timezone", e);
    }

    try {
      const state = getState();
      const botCtx = state.botContext;

      if (botCtx?.matchId) {
        headers.set("x-pkt-match-id", botCtx.matchId);
      }
      if (botCtx?.tournamentId) {
        headers.set("x-pkt-tournament-id", botCtx.tournamentId);
      }
      if (botCtx?.bracketId) {
        headers.set("x-pkt-bracket-id", botCtx.bracketId);
      }
      if (botCtx?.courtCode) {
        headers.set("x-pkt-court-code", botCtx.courtCode);
      }
    } catch (error) {
      console.log(error);
    }

    return headers;
  },
});

function redirectTo404() {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/404")) return;

  try {
    const origin = window.location.pathname + window.location.search;
    sessionStorage.setItem("nf_origin", origin);
  } catch (e) {
    console.log(e);
  }

  try {
    window.history.pushState({}, "", "/404");
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.assign("/404");
  }
}

function redirectTo503() {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/503")) return;

  try {
    const origin = window.location.pathname + window.location.search;
    sessionStorage.setItem("nf_origin", origin);
  } catch (e) {
    console.log(e);
  }

  try {
    window.history.pushState({}, "", "/503");
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.assign("/503");
  }
}

const baseQuery = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  const status = result?.error?.status;

  if (status === 401) {
    const url = typeof args === "string" ? args : args?.url || "";
    const isAuthEndpoint =
      url.includes("/auth") ||
      (url.includes("/users") && !url.includes("/profile"));

    if (!isAuthEndpoint) {
      try {
        api.dispatch(logout());
        api.dispatch(apiSlice.util.resetApiState());
      } catch (e) {
        console.log(e);
      }
      if (typeof window !== "undefined") window.location.href = "/login";
    }
    return result;
  }
  if (
    status === 403 &&
    result?.error?.data?.message === "Not authorized â€“ no token"
  ) {
    try {
      api.dispatch(logout());
      api.dispatch(apiSlice.util.resetApiState());
    } catch (e) {
      console.log(e);
    }
    if (typeof window !== "undefined") window.location.href = "/login";
    return result;
  }

  if (status === 404 && !extraOptions?.skip404Redirect) {
    redirectTo404();
  }
  if (status === 503) {
    redirectTo503();
  }

  return result;
};

export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: [
    "User",
    "Match",
    "Bracket",
    "Tournament",
    "Registration",
    "TournamentMatches",
    "Club",
    "ClubMember",
    "JoinRequest",
    "AvatarOptimization",
  ],
  endpoints: () => ({}),
});

export default apiSlice;

export const rtkQueryLogoutListener = createListenerMiddleware();

rtkQueryLogoutListener.startListening({
  actionCreator: logout,
  effect: async (_action, { dispatch }) => {
    dispatch(apiSlice.util.resetApiState());

    try {
      sessionStorage.removeItem("nf_origin");
    } catch (e) {
      console.log(e);
    }
  },
});
