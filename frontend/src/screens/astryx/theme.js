/**
 * theme.js — quản lý chế độ SÁNG/TỐI cho bộ giao diện Astryx (trong ShadowFrame).
 *
 * Nguồn sự thật: localStorage["pk-theme"] = "dark" | "light" (mặc định "dark").
 * - getPkTheme(): đọc theme hiện tại (đã chuẩn hoá).
 * - setPkTheme(t): ghi localStorage + notify mọi subscriber trong tab này.
 * - subscribePkTheme(cb): đăng ký listener (module-level), trả về hàm huỷ.
 *   Tab khác đổi theme -> sự kiện "storage" -> cũng notify (đồng bộ đa tab).
 * - usePkTheme(): hook React (useSyncExternalStore) — re-render khi theme đổi.
 *
 * ShadowFrame đọc theme này để đặt color-scheme + data-pk-theme trên :host;
 * token Astryx (light-dark()) và bộ var --pk-* tự đổi theo color-scheme.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "pk-theme";
const DEFAULT_THEME = "dark";

const normalize = (t) => (t === "light" ? "light" : DEFAULT_THEME);

// Cache trong module — localStorage có thể bị chặn (Safari private…) thì vẫn chạy
let current = (() => {
  try {
    return normalize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
})();

const listeners = new Set();
const emit = () => {
  for (const cb of listeners) {
    try {
      cb(current);
    } catch {
      /* một listener lỗi không được chặn các listener khác */
    }
  }
};

export const getPkTheme = () => current;

export const setPkTheme = (t) => {
  const next = normalize(t);
  if (next === current) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* không ghi được thì theme vẫn sống trong phiên này */
  }
  emit();
};

export const subscribePkTheme = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

// Tab/cửa sổ KHÁC đổi theme -> sự kiện storage (không bắn trong tab tự ghi)
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = normalize(e.newValue);
    if (next === current) return;
    current = next;
    emit();
  });
}

/** Hook: trả "dark" | "light", tự re-render khi đổi (kể cả từ tab khác). */
export const usePkTheme = () =>
  useSyncExternalStore(subscribePkTheme, getPkTheme, () => DEFAULT_THEME);
