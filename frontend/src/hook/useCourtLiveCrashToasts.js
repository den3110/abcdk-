// hook/useCourtLiveCrashToasts.js
// Emit toast.error khi 1 máy live chuyển sang "mất tín hiệu / crash".
// Chia sẻ logic giữa dialog quản lý live sân và watcher chạy nền ở trang quản lý giải.
//
// State transition — chỉ fire toast khi trạng thái đổi từ ok/null → lostSignal.
// Không fire lại cho cùng station đang lost đến khi user reload/component remount.
import { useEffect, useRef } from "react";
import { toast } from "react-toastify";

const sid = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const stationLabel = (station) => {
  const name =
    station?.name ||
    station?.court?.name ||
    station?.code ||
    station?.court?.code ||
    "";
  return String(name || "").trim();
};

/**
 * @param {Object} opts
 * @param {Array}  opts.stations — mảng station từ query monitor
 * @param {boolean} opts.enabled — bật/tắt (VD chỉ chạy khi user có quyền)
 * @param {string} [opts.toastIdPrefix] — prefix để tránh collision khi nhiều nơi cùng dùng
 */
export function useCourtLiveCrashToasts({
  stations,
  enabled = true,
  toastIdPrefix = "court-live-lost",
}) {
  const stateRef = useRef(new Map());

  useEffect(() => {
    if (!enabled) {
      stateRef.current = new Map();
      return;
    }
    if (!Array.isArray(stations)) return;

    const nextState = new Map();
    stations.forEach((station) => {
      const stationId = sid(station?._id);
      if (!stationId) return;
      const lostSignal = Boolean(station?.monitor?.lostSignal);
      nextState.set(stationId, lostSignal);
      if (lostSignal && stateRef.current.get(stationId) !== true) {
        const label = stationLabel(station);
        const detail = station?.monitor?.message;
        const message = detail
          ? label
            ? `${label}: ${detail}`
            : detail
          : `Máy live ${label || ""}`.trim() +
            " mất tín hiệu, có dấu hiệu crash. Hãy kiểm tra thiết bị và mở lại live.";
        toast.error(message, {
          toastId: `${toastIdPrefix}-${stationId}`,
          autoClose: 8000,
        });
      }
    });
    stateRef.current = nextState;
  }, [enabled, stations, toastIdPrefix]);
}
