// src/slices/apiSlice.js
import { fetchBaseQuery, createApi } from "@reduxjs/toolkit/query/react";
import { logout } from "./authSlice";
import { createListenerMiddleware } from "@reduxjs/toolkit";
import {
  addBusinessBreadcrumb,
  captureApiException,
  captureBusinessMessage,
} from "../utils/sentry";

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

const BUSINESS_MUTATION_MAP = {
  login: ({ args, result, state }) => ({
    name: "auth.login.success",
    data: {
      identifierTail: String(args?.identifier || args?.phone || "")
        .trim()
        .slice(-4),
      userId:
        result?._id ||
        result?.id ||
        result?.user?._id ||
        state?.auth?.userInfo?._id,
      userRole:
        result?.role ||
        result?.user?.role ||
        state?.auth?.userInfo?.role ||
        "user",
    },
  }),
  register: ({ args, result }) => ({
    name: "auth.register.success",
    data: {
      userId: result?._id || result?.id || result?.user?._id,
      province: args?.province,
      gender: args?.gender,
      hasAvatar: Boolean(args?.avatar),
    },
  }),
  updateUser: ({ args, result, state }) => ({
    name: "profile.update.success",
    data: {
      userId: result?._id || result?.id || state?.auth?.userInfo?._id,
      updatedFields: Object.keys(args || {}).filter(
        (key) => !["password", "confirmPassword", "token"].includes(key),
      ),
    },
  }),
  createRegistration: ({ args, result }) => ({
    name: args?.teamFactionId
      ? "team_tournament.roster.create.success"
      : "tournament.registration.create.success",
    data: {
      tournamentId: args?.tourId,
      registrationId:
        result?._id ||
        result?.id ||
        result?.registration?._id ||
        result?.registration?.id,
      teamFactionId: args?.teamFactionId,
      eventType: args?.eventType,
    },
  }),
  createTeamMatch: ({ args, result }) => ({
    name: "team_tournament.match.create.success",
    data: {
      tournamentId: args?.tourId,
      matchId: result?._id || result?.id || result?.match?._id,
      pairARegistrationId: args?.pairA,
      pairBRegistrationId: args?.pairB,
    },
  }),
  assignTournamentMatchToCourtStation: ({ args }) => ({
    name: "court_station.assign.success",
    data: {
      tournamentId: args?.tournamentId,
      courtStationId: args?.stationId,
      matchId: args?.matchId,
    },
  }),
  appendTournamentCourtStationQueueItem: ({ args }) => ({
    name: "court_station.queue.append.success",
    data: {
      tournamentId: args?.tournamentId,
      courtStationId: args?.stationId,
      matchId: args?.matchId,
    },
  }),
  updateTournamentCourtStationAssignmentConfig: ({ args }) => ({
    name: "court_station.config.save.success",
    data: {
      tournamentId: args?.tournamentId,
      courtStationId: args?.stationId,
      assignmentMode: args?.assignmentMode,
      queueCount: Array.isArray(args?.queueMatchIds)
        ? args.queueMatchIds.length
        : 0,
    },
  }),
};

function captureMutationBusinessEvent(endpoint, { args, result, state }) {
  const resolver = BUSINESS_MUTATION_MAP[endpoint];
  if (!resolver) return;

  const payload = resolver({ args, result, state }) || null;
  if (!payload?.name) return;

  captureBusinessMessage(payload.name, {
    ...payload.data,
    userId: payload.data?.userId || state?.auth?.userInfo?._id,
    userRole: payload.data?.userRole || state?.auth?.userInfo?.role,
  });
}

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
  const endpointName = api?.endpoint;
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
  if (status === 503 && !extraOptions?.skip503Redirect) {
    redirectTo503();
  }

  if (result?.error && !extraOptions?.skipSentryCapture) {
    try {
      captureApiException(result.error, {
        args,
        state: api.getState(),
      });
    } catch (e) {
      console.log("Failed to capture API exception in Sentry", e);
    }
  }

  if (
    result?.data &&
    api?.type === "mutation" &&
    endpointName &&
    !extraOptions?.skipBusinessEventCapture
  ) {
    try {
      captureMutationBusinessEvent(endpointName, {
        args,
        result: result.data,
        state: api.getState(),
      });
    } catch (e) {
      addBusinessBreadcrumb("telemetry.business.capture_failed", {
        endpoint: endpointName,
        reason: e?.message || "unknown",
      });
    }
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
    "LiveCluster",
    "LiveCourt",
    "TournamentCourtClusters",
    "TournamentCourtClusterRuntime",
    "CourtClusterRuntime",
    "TournamentManagers",
    "Tournaments",
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
