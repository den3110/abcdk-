function asTrimmed(value) {
  return String(value || "").trim();
}

function normalizeBaseUrl(value) {
  const raw = asTrimmed(value).replace(/\/+$/, "");
  if (!raw) return "";
  try {
    return new URL(raw).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function normalizePathPrefix(value) {
  const raw = asTrimmed(value);
  if (!raw || raw === "/") return "";
  const normalized = `/${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return normalized === "/" ? "" : normalized;
}

function parseInteger(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.floor(numeric);
}

function parseAllowedOrigins(value) {
  const raw = asTrimmed(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => asTrimmed(item)).filter(Boolean);
    }
  } catch {
    return raw
      .split(",")
      .map((item) => asTrimmed(item))
      .filter(Boolean);
  }
  return [];
}

function buildTargetMap(env) {
  const targetMap = new Map();

  for (const [key, value] of Object.entries(env || {})) {
    const match = /^TARGET_(R2_\d{2})_URL$/i.exec(key);
    if (!match) continue;

    const normalizedUrl = normalizeBaseUrl(value);
    if (!normalizedUrl) continue;

    const targetId = match[1].toLowerCase().replace(/_/g, "-");
    targetMap.set(targetId, normalizedUrl);
  }

  return targetMap;
}

function buildCorsHeaders(request, allowedOrigins) {
  const origin = asTrimmed(request.headers.get("Origin"));
  const headers = new Headers();

  if (allowedOrigins.includes("*")) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range, Content-Type, Accept");
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Length, Content-Range, ETag, Accept-Ranges"
  );

  return headers;
}

function mergeHeaders(base, extra) {
  const headers = new Headers(base);
  for (const [key, value] of extra.entries()) {
    headers.set(key, value);
  }
  return headers;
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

function resolveTargetRequest(url, env) {
  const pathPrefix = normalizePathPrefix(env.PATH_PREFIX);
  const pathname = url.pathname || "/";

  if (pathname === "/healthz") {
    return { kind: "health" };
  }

  if (pathPrefix) {
    if (pathname !== pathPrefix && !pathname.startsWith(`${pathPrefix}/`)) {
      return { kind: "miss", status: 404, message: "Route prefix not matched" };
    }
  }

  const relativePath = pathPrefix ? pathname.slice(pathPrefix.length) || "/" : pathname;
  const match = /^\/(r2-\d{2})(\/.*)?$/i.exec(relativePath);

  if (!match) {
    return {
      kind: "miss",
      status: 404,
      message: "Expected /r2-01/... style path",
    };
  }

  const targetId = String(match[1] || "").toLowerCase();
  const targetMap = buildTargetMap(env);
  const upstreamBaseUrl = targetMap.get(targetId) || "";

  if (!upstreamBaseUrl) {
    return {
      kind: "miss",
      status: 404,
      message: `No upstream configured for ${targetId}`,
    };
  }

  const suffixPath = match[2] || "/";
  const upstreamUrl = new URL(`${suffixPath}${url.search}`, `${upstreamBaseUrl}/`);

  return {
    kind: "proxy",
    targetId,
    targetCount: targetMap.size,
    upstreamBaseUrl,
    upstreamUrl,
    pathPrefix,
  };
}

export default {
  async fetch(request, env) {
    const method = String(request.method || "GET").toUpperCase();
    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS_JSON);
    const corsHeaders = buildCorsHeaders(request, allowedOrigins);
    const url = new URL(request.url);
    const resolved = resolveTargetRequest(url, env);

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    if (!["GET", "HEAD"].includes(method)) {
      return jsonResponse(
        {
          ok: false,
          message: "Only GET, HEAD, and OPTIONS are supported.",
        },
        405,
        Object.fromEntries(corsHeaders.entries())
      );
    }

    if (resolved.kind === "health") {
      const targetMap = buildTargetMap(env);
      return jsonResponse(
        {
          ok: true,
          service: "r2-gateway",
          configuredTargets: Array.from(targetMap.keys()).sort(),
          targetCount: targetMap.size,
          pathPrefix: normalizePathPrefix(env.PATH_PREFIX),
        },
        200,
        Object.fromEntries(corsHeaders.entries())
      );
    }

    if (resolved.kind !== "proxy") {
      return jsonResponse(
        {
          ok: false,
          message: resolved.message,
          pathPrefix: normalizePathPrefix(env.PATH_PREFIX),
        },
        resolved.status || 404,
        Object.fromEntries(corsHeaders.entries())
      );
    }

    const cacheTtl = parseInteger(env.CACHE_TTL_SECONDS, 0);
    const upstreamRequest = new Request(resolved.upstreamUrl.toString(), request);
    const upstreamResponse = await fetch(
      upstreamRequest,
      cacheTtl > 0
        ? {
            cf: {
              cacheEverything: true,
              cacheTtl,
            },
          }
        : undefined
    );

    const responseHeaders = mergeHeaders(upstreamResponse.headers, corsHeaders);
    responseHeaders.set("x-r2-gateway-target", resolved.targetId);
    responseHeaders.set("x-r2-gateway-upstream", resolved.upstreamBaseUrl);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
