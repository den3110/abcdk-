import { getObserverReadProxyConfig } from "./observerConfig.service.js";

function asTrimmed(value) {
  return String(value || "").trim();
}

function appendQueryParams(url, query = {}) {
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string" && !value.trim()) return;
    if (typeof value === "boolean") {
      url.searchParams.set(key, value ? "true" : "false");
      return;
    }
    url.searchParams.set(key, String(value));
  });
}

function toProxyError(message, extras = {}) {
  const error = new Error(message);
  Object.assign(error, extras);
  return error;
}

export async function fetchObserverJson(path, options = {}) {
  const cfg = getObserverReadProxyConfig();
  const normalizedPath = String(path || "").trim();
  const query = options?.query && typeof options.query === "object" ? options.query : {};
  const useReadKey = options?.useReadKey !== false;

  if (!cfg.baseUrl) {
    throw toProxyError("Observer VPS chưa được cấu hình OBSERVER_BASE_URL.", {
      statusCode: 503,
      code: "observer_base_url_missing",
    });
  }

  if (useReadKey && !cfg.readApiKey) {
    throw toProxyError("Observer VPS chưa được cấu hình OBSERVER_READ_API_KEY.", {
      statusCode: 503,
      code: "observer_read_key_missing",
    });
  }

  const baseUrl = cfg.baseUrl.endsWith("/") ? cfg.baseUrl : `${cfg.baseUrl}/`;
  const url = new URL(
    normalizedPath.startsWith("/") ? normalizedPath.slice(1) : normalizedPath,
    baseUrl
  );
  appendQueryParams(url, query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: useReadKey
        ? {
            "x-pkt-observer-key": cfg.readApiKey,
          }
        : {},
      signal: controller.signal,
    });

    const contentType = asTrimmed(response.headers.get("content-type")).toLowerCase();
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    if (!response.ok) {
      const upstreamMessage =
        typeof payload === "object" && payload
          ? asTrimmed(payload.message || payload.error)
          : asTrimmed(payload);

      throw toProxyError(
        upstreamMessage || `Observer VPS trả về HTTP ${response.status}.`,
        {
          statusCode: response.status >= 500 ? 502 : response.status,
          code: "observer_upstream_error",
          upstreamStatus: response.status,
          upstreamPayload: payload,
        }
      );
    }

    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw toProxyError("Observer VPS phản hồi quá chậm.", {
        statusCode: 504,
        code: "observer_timeout",
      });
    }

    if (error?.code) {
      throw error;
    }

    throw toProxyError(
      error?.message || "Không thể kết nối tới Observer VPS.",
      {
        statusCode: 502,
        code: "observer_request_failed",
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}
