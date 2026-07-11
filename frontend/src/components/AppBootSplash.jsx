/**
 * AppBootSplash — màn hình chờ lúc app khởi động, ĂN THEO phiên bản giao diện + theme:
 *  - Bản "v1" (giao diện cũ): nền trắng + icon PNG cũ nhấp nháy (đúng splash ngày xưa).
 *  - Bản "v2" (Astryx): PickleMark xoay loop; nền/chữ theo theme sáng/tối (key "pk-theme").
 * Splash hiện TRƯỚC khi /api/app/init trả về nên không thể hỏi server — đọc đồng bộ:
 *  ?ui= trên URL (override test) > localStorage "pk-ui-version" (AppInitGate cache sau mỗi
 *  lần app-init resolve) > mặc định v2. Lần ghé đầu tiên chưa có cache -> v2 (khớp
 *  DEFAULT_WHEN_UNKNOWN của useAstryxUi).
 */
import PickleMark from "../screens/astryx/PickleMark.jsx";

const FONT_STACK =
  '"Figtree Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const readSplashVariant = () => {
  try {
    const uiParam = String(
      new URLSearchParams(window.location.search).get("ui") || "",
    )
      .trim()
      .toLowerCase();
    const cached = String(localStorage.getItem("pk-ui-version") || "")
      .trim()
      .toLowerCase();
    const isV1 = uiParam === "v1" || (uiParam !== "v2" && cached === "v1");
    const isLight =
      String(localStorage.getItem("pk-theme") || "").trim().toLowerCase() ===
      "light";
    return { isV1, isLight };
  } catch {
    return { isV1: false, isLight: false };
  }
};

export default function AppBootSplash({ brand = "PICKLETOUR", message = "" }) {
  const { isV1, isLight } = readSplashVariant();

  /* ---- bản v1: giữ đúng splash cũ (nền trắng, icon pulse) ---- */
  if (isV1) {
    return (
      <div
        role="status"
        aria-label={message || brand}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
        }}
      >
        <img
          src="/icon-512.png"
          alt={message || brand}
          style={{ width: 64, height: 64, animation: "appBootPulse 1.2s ease-in-out infinite" }}
        />
        <style>
          {`@keyframes appBootPulse{0%,100%{opacity:.4;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}`}
        </style>
      </div>
    );
  }

  /* ---- bản v2 (Astryx): PickleMark xoay, màu theo theme sáng/tối ---- */
  const c = isLight
    ? { bg: "#FFFFFF", mark: "#225BFF", brand: "#6B7075", msg: "#8A8F94" }
    : { bg: "#111112", mark: "#3D87FF", brand: "#8F959C", msg: "#565B61" };

  return (
    <div
      role="status"
      aria-label={message || brand}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        background: c.bg,
      }}
    >
      <div style={{ animation: "pkBootSpin 1.5s cubic-bezier(.45,.05,.55,.95) infinite" }}>
        <PickleMark size={56} color={c.mark} />
      </div>
      <div style={{ textAlign: "center", userSelect: "none" }}>
        <div
          style={{
            fontFamily: FONT_STACK,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: ".32em",
            textIndent: ".32em",
            color: c.brand,
          }}
        >
          {brand}
        </div>
        {message && (
          <div style={{ marginTop: 8, fontFamily: FONT_STACK, fontSize: 11.5, fontWeight: 600, color: c.msg }}>
            {message}
          </div>
        )}
      </div>
      <style>
        {`@keyframes pkBootSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}
      </style>
    </div>
  );
}
