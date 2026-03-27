import * as Sentry from "@sentry/react";

const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN ||
  "https://18daf7f17059ea6b670185ad8fd3903e@o4511108632739840.ingest.de.sentry.io/4511108634181712";

const SENTRY_ENVIRONMENT =
  import.meta.env.VITE_SENTRY_ENVIRONMENT ||
  import.meta.env.MODE ||
  "development";

const SENTRY_RELEASE =
  import.meta.env.VITE_SENTRY_RELEASE ||
  import.meta.env.VITE_APP_VERSION ||
  undefined;

let sentryInitialized = false;
let lastNavigationKey = "";

function parseSampleRate(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function buildTraceTargets() {
  const targets = [/^\//, /^https:\/\/pickletour\.vn/i];
  const apiUrl = import.meta.env.VITE_API_URL;
  const socketUrl = import.meta.env.VITE_API_URL_SOCKET;

  if (apiUrl) targets.push(apiUrl);
  if (socketUrl) targets.push(socketUrl);

  return targets;
}

function normalizeRouteValue(value) {
  return String(value || "").trim() || "/";
}

function getCurrentRouteValue() {
  if (typeof window === "undefined") return "/";
  return normalizeRouteValue(
    `${window.location.pathname || "/"}${window.location.search || ""}`,
  );
}

function cleanBusinessData(data = {}) {
  return Object.fromEntries(
    Object.entries(data || {}).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && !value.trim()) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}

function buildBusinessData(data = {}) {
  return cleanBusinessData({
    route: getCurrentRouteValue(),
    release: SENTRY_RELEASE || undefined,
    environment: SENTRY_ENVIRONMENT || undefined,
    ...data,
  });
}

function normalizeApiRequest(args) {
  if (typeof args === "string") {
    return {
      url: args,
      method: "GET",
    };
  }

  return {
    url: args?.url || "",
    method: String(args?.method || "GET").toUpperCase(),
    params: args?.params,
    body: args?.body,
  };
}

function getApiStatus(error) {
  if (typeof error?.status === "number") return error.status;
  if (typeof error?.originalStatus === "number") return error.originalStatus;
  return error?.status || "unknown";
}

function isExpectedApiError(error, args) {
  const request = normalizeApiRequest(args);
  const status = error?.status;
  const message = String(error?.data?.message || error?.error || "");

  if (status === 401 || status === 404) return true;
  if (status === 403 && /no token/i.test(message)) return true;
  if (status === "PARSING_ERROR" && /\.map($|\?)/i.test(request.url || "")) {
    return true;
  }

  return false;
}

function getUserPayload(userInfo) {
  const userId = userInfo?._id || userInfo?.id || null;
  if (!userId && !userInfo?.email) return null;

  return {
    id: userId || undefined,
    email: userInfo?.email || undefined,
    username: userInfo?.nickname || userInfo?.name || undefined,
  };
}

function getUserRole(userInfo) {
  if (userInfo?.role) return String(userInfo.role);
  if (Array.isArray(userInfo?.roles) && userInfo.roles[0]) {
    return String(userInfo.roles[0]);
  }
  return undefined;
}

export function initSentry({ routerTracingIntegration } = {}) {
  if (sentryInitialized || !SENTRY_DSN) return;

  const tracesSampleRate = parseSampleRate(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
    0.2,
  );
  const replaysSessionSampleRate = parseSampleRate(
    import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
    0.05,
  );
  const replaysOnErrorSampleRate = parseSampleRate(
    import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
    1,
  );

  const integrations = [];

  if (routerTracingIntegration) {
    integrations.push(routerTracingIntegration);
  }

  if (replaysSessionSampleRate > 0 || replaysOnErrorSampleRate > 0) {
    integrations.push(Sentry.replayIntegration());
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    sendDefaultPii: true,
    attachStacktrace: true,
    tracesSampleRate,
    replaysSessionSampleRate,
    replaysOnErrorSampleRate,
    tracePropagationTargets: buildTraceTargets(),
    integrations,
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
    ],
    beforeSend(event, hint) {
      const originalError = hint?.originalException;
      const errorMessage = String(
        originalError?.message ||
          event?.exception?.values?.[0]?.value ||
          event?.message ||
          "",
      );

      if (/extension:\/\//i.test(errorMessage)) {
        return null;
      }

      return event;
    },
  });

  sentryInitialized = true;
}

export function setSentryUserContext(userInfo) {
  const sentryUser = getUserPayload(userInfo);

  Sentry.setUser(sentryUser);

  if (!sentryUser) {
    Sentry.setTag("role", "guest");
    Sentry.setContext("auth", {
      role: "guest",
      isAdmin: false,
      isSuperAdmin: false,
    });
    return;
  }

  const role = getUserRole(userInfo);
  if (role) {
    Sentry.setTag("role", role);
  }

  Sentry.setContext("auth", {
    role: role || null,
    isAdmin: Boolean(userInfo?.isAdmin),
    isSuperAdmin: Boolean(userInfo?.isSuperAdmin || userInfo?.isSuperUser),
  });
}

export function clearSentryUserContext() {
  Sentry.setUser(null);
  Sentry.setTag("role", "guest");
  Sentry.setContext("auth", {
    role: "guest",
    isAdmin: false,
    isSuperAdmin: false,
  });
}

export function addSentryNavigationBreadcrumb(location) {
  const pathname = normalizeRouteValue(location?.pathname);
  const search = String(location?.search || "");
  const hash = String(location?.hash || "");
  const routeKey = `${pathname}${search}${hash}`;

  if (routeKey === lastNavigationKey) return;
  lastNavigationKey = routeKey;

  Sentry.setTag("route", pathname);
  Sentry.addBreadcrumb({
    category: "navigation",
    type: "navigation",
    level: "info",
    message: routeKey,
    data: {
      pathname,
      search,
      hash,
    },
  });
}

export function addBusinessBreadcrumb(name, data = {}, level = "info") {
  if (!name) return;

  Sentry.addBreadcrumb({
    category: "business",
    type: "default",
    level,
    message: name,
    data: buildBusinessData(data),
  });
}

export function captureBusinessMessage(name, data = {}, level = "info") {
  if (!name) return;

  const payload = buildBusinessData(data);
  addBusinessBreadcrumb(name, payload, level);

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("event_category", "business");
    scope.setTag("business_event", name);
    scope.setTag("route", normalizeRouteValue(payload.route));

    if (payload.environment) {
      scope.setTag("environment", payload.environment);
    }
    if (payload.release) {
      scope.setTag("release", payload.release);
    }

    scope.setContext("business", payload);
    Sentry.captureMessage(name);
  });
}

export function captureApiException(error, { args, state } = {}) {
  if (!error || isExpectedApiError(error, args)) return;

  const request = normalizeApiRequest(args);
  const status = getApiStatus(error);
  const route =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.search}`
      : "/";
  const userInfo = state?.auth?.userInfo || null;
  const level =
    typeof status === "number" && status >= 500 ? "error" : "warning";

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag("error_source", "rtk-query");
    scope.setTag("route", normalizeRouteValue(route));

    if (request.method) scope.setTag("api_method", request.method);
    if (request.url) scope.setTag("api_url", request.url);
    if (typeof status === "number") scope.setTag("api_status", String(status));

    const sentryUser = getUserPayload(userInfo);
    if (sentryUser) {
      scope.setUser(sentryUser);
    }

    scope.setContext("api", {
      url: request.url || null,
      method: request.method || null,
      params: request.params || null,
      status,
      response: error?.data || error?.error || null,
    });

    if (state?.botContext) {
      scope.setContext("botContext", state.botContext);
    }

    const message = `[API] ${request.method} ${request.url || "unknown"} failed`;
    const exception = new Error(message);
    exception.name = "ApiRequestError";

    Sentry.captureException(exception);
  });
}

export function getSentryRelease() {
  return SENTRY_RELEASE;
}

export function getSentryEnvironment() {
  return SENTRY_ENVIRONMENT;
}
