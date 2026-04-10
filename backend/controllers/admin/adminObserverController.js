import asyncHandler from "express-async-handler";
import { getObserverAzureVmStatus } from "../../services/azureVmWorker.service.js";
import { getObserverReadProxyConfig } from "../../services/observerConfig.service.js";
import { fetchObserverJson } from "../../services/observerReadProxy.service.js";

function asTrimmed(value) {
  return String(value || "").trim();
}

function toPositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.floor(numeric);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
}

function toBoolean(value, fallback = false) {
  const normalized = asTrimmed(value).toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function buildEmptyObserverPayload() {
  return {
    summary: {
      ok: true,
      events: {
        totalRecentEvents: 0,
        errorRecentEvents: 0,
        buckets: [],
      },
      runtime: null,
      backups: [],
      liveDevices: {
        counts: {
          total: 0,
          online: 0,
          live: 0,
          overlayIssues: 0,
          criticalRecoveries: 0,
          suspectedCrashes: 0,
        },
        items: [],
      },
    },
    liveDevices: {
      ok: true,
      counts: {
        total: 0,
        online: 0,
        live: 0,
        overlayIssues: 0,
        criticalRecoveries: 0,
        suspectedCrashes: 0,
      },
      items: [],
    },
    deviceEvents: { ok: true, items: [] },
    errorEvents: { ok: true, items: [] },
  };
}

function buildObserverAvailability(azureVm, fallbackState = "unknown", fallbackMessage = "") {
  if (azureVm?.isStopped) {
    return {
      state: "azure_stopped",
      severity: "info",
      title: "Observer VPS Azure đã tắt",
      message:
        "Azure VM đang stopped/deallocated nên Observer VPS không nhận heartbeat hoặc log realtime. Bật lại VM trong Azure Manager để tiếp tục theo dõi.",
      checkedAt: azureVm.checkedAt || new Date().toISOString(),
    };
  }

  if (azureVm?.isTransitioning) {
    return {
      state: "azure_transitioning",
      severity: "warning",
      title: "Observer VPS Azure đang chuyển trạng thái",
      message: "Azure VM đang start/stop. Đợi vài chục giây rồi làm mới lại trang.",
      checkedAt: azureVm.checkedAt || new Date().toISOString(),
    };
  }

  if (azureVm?.isRunning) {
    return {
      state: "online",
      severity: "success",
      title: "Observer VPS đang chạy",
      message: "Azure VM đang running và Observer VPS phản hồi bình thường.",
      checkedAt: azureVm.checkedAt || new Date().toISOString(),
    };
  }

  return {
    state: fallbackState,
    severity: fallbackState === "online" ? "success" : "warning",
    title:
      fallbackState === "online"
        ? "Observer VPS đang chạy"
        : "Chưa xác định trạng thái Observer VPS",
    message: fallbackMessage || "Chưa đọc được trạng thái Azure VM của Observer VPS.",
    checkedAt: new Date().toISOString(),
  };
}

function formatProxyError(res, error, extras = {}) {
  const statusCode = Number(error?.statusCode) || 502;
  return res.status(statusCode).json({
    ok: false,
    message: error?.message || "Không thể đọc dữ liệu Observer VPS.",
    code: error?.code || "observer_proxy_failed",
    upstreamStatus: error?.upstreamStatus || null,
    observerAzureVm: extras.observerAzureVm || null,
    observerAvailability:
      extras.observerAvailability ||
      buildObserverAvailability(
        extras.observerAzureVm,
        "unreachable",
        "Observer VPS chưa phản hồi qua server chính.",
      ),
    details:
      error?.upstreamPayload && typeof error.upstreamPayload === "object"
        ? error.upstreamPayload
        : null,
  });
}

export const getAdminObserverOverview = asyncHandler(async (req, res) => {
  const source = asTrimmed(req.query?.source);
  const deviceId = asTrimmed(req.query?.deviceId);
  const minutes = toPositiveInt(req.query?.minutes, 60, {
    min: 5,
    max: 24 * 60,
  });
  const deviceLimit = toPositiveInt(req.query?.deviceLimit, 50, {
    min: 1,
    max: 200,
  });
  const deviceEventLimit = toPositiveInt(req.query?.deviceEventLimit, 30, {
    min: 1,
    max: 100,
  });
  const errorLimit = toPositiveInt(req.query?.errorLimit, 20, {
    min: 1,
    max: 100,
  });
  const onlineOnly = toBoolean(req.query?.onlineOnly, false);
  const observerCfg = getObserverReadProxyConfig();
  const observerAzureVm = await getObserverAzureVmStatus(observerCfg.baseUrl);

  if (observerAzureVm?.isStopped) {
    return res.json({
      ok: true,
      source: source || null,
      selectedDeviceId: deviceId || null,
      windowMinutes: minutes,
      observerAzureVm,
      observerAvailability: buildObserverAvailability(observerAzureVm),
      observerHealth: {
        ok: false,
        service: "pickletour-observer-go",
        azurePowerState: observerAzureVm.powerState,
        now: new Date().toISOString(),
      },
      ...buildEmptyObserverPayload(),
      proxiedAt: new Date().toISOString(),
    });
  }

  try {
    const [health, summary, liveDevices, deviceEvents, errorEvents] =
      await Promise.all([
        fetchObserverJson("/healthz", { useReadKey: false }),
        fetchObserverJson("/api/observer/read/summary", {
          query: { source, minutes },
        }),
        fetchObserverJson("/api/observer/read/live-devices", {
          query: { source, limit: deviceLimit, onlineOnly },
        }),
        fetchObserverJson("/api/observer/read/events", {
          query: {
            source,
            deviceId,
            category: "live_device",
            limit: deviceEventLimit,
          },
        }),
        fetchObserverJson("/api/observer/read/events", {
          query: { source, deviceId, level: "error", limit: errorLimit },
        }),
      ]);

    return res.json({
      ok: true,
      source: source || null,
      selectedDeviceId: deviceId || null,
      windowMinutes: minutes,
      observerAzureVm,
      observerAvailability: buildObserverAvailability(observerAzureVm, "online"),
      observerHealth: health,
      summary,
      liveDevices,
      deviceEvents,
      errorEvents,
      proxiedAt: new Date().toISOString(),
    });
  } catch (error) {
    return formatProxyError(res, error, {
      observerAzureVm,
      observerAvailability: buildObserverAvailability(
        observerAzureVm,
        "unreachable",
        "Observer VPS chưa phản hồi qua server chính.",
      ),
    });
  }
});
