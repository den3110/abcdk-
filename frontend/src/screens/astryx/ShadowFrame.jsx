/**
 * ShadowFrame — cô lập trang Astryx khỏi CSS toàn cục (Bootstrap/MUI) bằng Shadow DOM.
 *
 * Vì sao: Astryx để CSS trong @layer ưu tiên thấp; app có Bootstrap/MUI unlayered đè vỡ.
 * Shadow DOM chặn CSS ngoài lọt vào, và ta nạp CSS Astryx (dạng string ?inline) VÀO shadow
 * nên nó không rò ra v1. Data/RTK/router vẫn chạy vì createPortal giữ nguyên React context.
 *
 * CSS Astryx có :root (tokens) + html/body (base) — trong shadow phải remap sang :host.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ?inline: lấy nội dung CSS dạng chuỗi, KHÔNG tiêm vào document toàn cục
import resetCssRaw from "@astryxdesign/core/reset.css?inline";
import astryxCssRaw from "@astryxdesign/core/astryx.css?inline";
import themeCssRaw from "@astryxdesign/theme-neutral/theme.css?inline";

import { usePkTheme } from "./theme.js";

// Remap selector gốc-tài-liệu -> :host để token/base áp trong shadow
const scopeToHost = (css) =>
  String(css || "")
    .replace(/:root\b/g, ":host")
    .replace(/(^|[\s,{(>~+])html\b/g, "$1:host")
    .replace(/(^|[\s,{(>~+])body\b/g, "$1:host");

// Override token (đặt CUỐI, unlayered, target cả selector theme để THẮNG theme-neutral):
//  - Font đẹp hơn (Figtree)
//  - Trả accent về XANH (theme-neutral cố tình đè accent thành xám) -> nút primary + icon accent rực lên
const FONT_STACK =
  '"Figtree Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const OVERRIDE = `
[data-astryx-theme="neutral"], :host {
  /* Mặc định DARK (như trước giờ) — ShadowFrame gắn data-pk-theme trên :host,
     khi = "light" thì rule bên dưới lật color-scheme => mọi light-dark() tự đổi. */
  color-scheme: dark;
  --font-family-body: ${FONT_STACK};
  --font-family-heading: ${FONT_STACK};
  --color-accent: light-dark(#0064E0, #2694FE);
  --color-text-accent: light-dark(#0064E0, #3E9EFB);
  --color-accent-muted: light-dark(#0082FB33, #0082FB3F);
  --color-text-blue: light-dark(#0064E0, #3E9EFB);
  --color-on-accent: light-dark(#FFFFFF, #FFFFFF);
  /* Brand blue của Astryx (đo từ token thật của họ) */
  --color-brand: light-dark(#225BFF, #3D87FF);

  /* ===== bộ var giao diện PickleTour (pk-*) — dark GIỮ NGUYÊN giá trị cũ,
     light chọn cho nền sáng; light-dark() resolve theo color-scheme ===== */
  --pk-text-strong: light-dark(#1A1B1E, #F0F1F3);
  --pk-text: light-dark(#3D4247, #C9CDD2);
  --pk-text-mute: light-dark(#6B7075, #8F959C);
  --pk-text-faint: light-dark(#8A8F94, #6E747B);
  --pk-surface-2: light-dark(rgba(0,0,0,.04), rgba(255,255,255,.05));
  --pk-border-2: light-dark(rgba(0,0,0,.12), rgba(255,255,255,.12));
  --pk-chip-bg: light-dark(rgba(0,0,0,.05), rgba(255,255,255,.06));
  /* pill (ui.jsx): "trắng" = primary trên nền tối -> light ĐẢO thành nền tối chữ trắng */
  --pk-pill-bg: light-dark(#1A1B1E, #F2F3F5);
  --pk-pill-fg: light-dark(#FFFFFF, #101114);
  --pk-pill2-bg: light-dark(#E9EAEC, #2A2B2F);
  --pk-pill2-fg: light-dark(#26282B, #E6E8EA);
  --pk-pill2-border: light-dark(rgba(0,0,0,.08), rgba(255,255,255,0.07));
}
/* Chế độ SÁNG: lật color-scheme cho :host và cả wrapper của <Theme>
   (wrapper có rule color-scheme: dark ở trên nên phải đè tường minh) */
:host([data-pk-theme="light"]),
:host([data-pk-theme="light"]) [data-astryx-theme="neutral"] {
  color-scheme: light;
}
`;

// Bố cục hero: thẻ showcase nổi quanh tiêu đề giữa (ẩn trên màn hẹp), shadow sâu tạo chiều sâu.
const EXTRA_CSS = `
.pk-hero { position: relative; overflow: hidden; }
.pk-hero-inner { position: relative; z-index: 3; }
.pk-float {
  position: absolute; z-index: 1;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-background-surface);
  box-shadow: 0 30px 70px -28px rgba(0,0,0,.62), 0 6px 18px -10px rgba(0,0,0,.4);
  overflow: hidden;
}
.pk-card {
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-background-surface);
  box-shadow: 0 18px 44px -22px rgba(0,0,0,.5);
}
@media (max-width: 1120px) { .pk-float { display: none !important; } }
@media (min-width: 1120px) { .pk-hero { min-height: 830px; } }
@media (max-width: 980px) { .pk-navlinks { display: none !important; } }
.pk-fade { animation: pkFade .45s cubic-bezier(.2,.7,.2,1); }
@keyframes pkFade {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.pk-trow:hover { background: color-mix(in srgb, var(--color-text-primary) 4%, transparent); }
.pk-menuitem:hover { background: light-dark(rgba(0,0,0,.05), rgba(255,255,255,0.07)); }

/* ===== thẻ giải đấu (TournamentsPage) ===== */
.pk-tcard { transition: transform .25s cubic-bezier(.2,.7,.2,1), border-color .25s, box-shadow .25s; will-change: transform; }
.pk-tcard:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--color-brand, #3D87FF) 45%, var(--color-border));
  box-shadow: 0 24px 54px -22px rgba(0,0,0,.6), 0 0 0 1px color-mix(in srgb, var(--color-brand, #3D87FF) 18%, transparent);
}
.pk-tcard-img { transition: transform .55s cubic-bezier(.2,.7,.2,1); }
.pk-tcard:hover .pk-tcard-img { transform: scale(1.06); }
.pk-reveal-card { opacity: 0; animation: pkRise .6s cubic-bezier(.2,.7,.2,1) forwards; }
/* watermark pinwheel xoay rất chậm ở đầu trang */
@keyframes pkSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.pk-spin-slow { animation: pkSpin 90s linear infinite; }
/* thẻ spotlight chiếm 2 cột khi đủ rộng */
@media (min-width: 760px) { .pk-span2 { grid-column: span 2; } }
/* ảnh lightbox phóng vào mượt */
.pk-zoomin { animation: pkZoomIn .28s cubic-bezier(.2,.7,.2,1); }
@keyframes pkZoomIn { from { opacity: 0; transform: scale(.93); } to { opacity: 1; transform: none; } }

/* ===== bảng xếp hạng (RankingsPage) ===== */
.pk-rankgrid { display: grid; grid-template-columns: 58px minmax(0,1.6fr) 130px 92px 92px 84px; align-items: center; }
@media (max-width: 860px) {
  .pk-rankgrid { grid-template-columns: 44px minmax(0,1fr) 86px 86px; }
  .pk-col-hide { display: none !important; }
}
@media (max-width: 760px) {
  .pk-podium { grid-template-columns: 1fr !important; align-items: stretch !important; }
  .pk-pod-1 { order: -1; }
}

/* ===== feed dọc kiểu TikTok (LivePage) ===== */
.pk-feed { scrollbar-width: none; -ms-overflow-style: none; }
.pk-feed::-webkit-scrollbar { display: none; width: 0; height: 0; }
.pk-spinning { animation: pkSpin 1s linear infinite; }
.pk-slidein { animation: pkSlideIn .26s cubic-bezier(.2,.7,.2,1); }

/* ===== form hồ sơ (ProfilePage) ===== */
.pk-input {
  width: 100%;
  box-sizing: border-box;
  background: light-dark(rgba(0,0,0,.03), rgba(255,255,255,.04));
  border: 1px solid light-dark(rgba(0,0,0,.14), rgba(255,255,255,.11));
  border-radius: 12px;
  padding: 11px 14px;
  color: var(--pk-text-strong);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color .18s, box-shadow .18s, background .18s;
}
.pk-input::placeholder { color: var(--pk-text-faint); }
.pk-input:hover { border-color: light-dark(rgba(0,0,0,.26), rgba(255,255,255,.2)); }
.pk-input:focus {
  border-color: rgba(61,135,255,.6);
  box-shadow: 0 0 0 3px rgba(61,135,255,.16);
  background: light-dark(rgba(0,0,0,.02), rgba(255,255,255,.055));
}
.pk-input:disabled { opacity: .55; cursor: not-allowed; }
select.pk-input { appearance: none; cursor: pointer; }
select.pk-input option { background: light-dark(#FFFFFF, #17181B); color: light-dark(#26282B, #E6E8EA); }
input.pk-input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(.7); cursor: pointer; }
/* light: icon lịch của trình duyệt vốn đã tối — bỏ invert */
:host([data-pk-theme="light"]) input.pk-input[type="date"]::-webkit-calendar-picker-indicator { filter: none; }
.pk-avatar-edit { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(8,9,11,.55); opacity: 0; transition: opacity .2s; cursor: pointer; border-radius: 999px; }
.pk-avatar-wrap:hover .pk-avatar-edit { opacity: 1; }
@keyframes pkSaveUp { from { opacity: 0; transform: translate(-50%, 16px); } to { opacity: 1; transform: translate(-50%, 0); } }
.pk-savebar { animation: pkSaveUp .28s cubic-bezier(.2,.7,.2,1); }

/* ===== nội dung HTML từ BTC (điều lệ/liên hệ) — trang chi tiết giải ===== */
.pk-prose { color: light-dark(#3D4247, #C3C8CE); font-size: 14.5px; line-height: 1.78; word-break: break-word; }
.pk-prose p { margin: 0 0 10px; }
.pk-prose p:last-child { margin-bottom: 0; }
.pk-prose strong, .pk-prose b { color: var(--pk-text-strong); font-weight: 700; }
.pk-prose a { color: var(--color-text-accent, #3E9EFB); }
.pk-prose ul, .pk-prose ol { margin: 0 0 10px; padding-left: 22px; }
.pk-prose li { margin: 3px 0; }
.pk-prose h1, .pk-prose h2, .pk-prose h3, .pk-prose h4 { color: var(--pk-text-strong); margin: 18px 0 8px; font-size: 16.5px; font-weight: 750; line-height: 1.4; }
.pk-prose img { max-width: 100%; height: auto; border-radius: 12px; }
.pk-prose table { width: 100%; border-collapse: collapse; margin: 10px 0; }
.pk-prose td, .pk-prose th { border: 1px solid var(--pk-border-2); padding: 6px 10px; }
.pk-prose blockquote { margin: 10px 0; padding: 8px 14px; border-left: 3px solid rgba(61,135,255,.5); background: light-dark(rgba(0,0,0,.03), rgba(255,255,255,.04)); border-radius: 0 10px 10px 0; }
@keyframes pkSlideIn { from { transform: translateX(44px); opacity: 0; } to { transform: none; opacity: 1; } }
.pk-seek { cursor: pointer; }
.pk-seek:hover .pk-seek-bar { height: 5px; }
.pk-seek .pk-seek-bar { transition: height .15s ease; }
@media (prefers-reduced-motion: reduce) {
  .pk-reveal-card { animation: none !important; opacity: 1 !important; }
  .pk-tcard, .pk-tcard-img { transition: none; }
  .pk-spin-slow { animation: none !important; }
}
@media (max-width: 900px) {
  .pk-3col { grid-template-columns: 1fr !important; }
  .pk-2col { grid-template-columns: 1fr !important; }
  .pk-foot { grid-template-columns: 1fr 1fr !important; }
}

/* ===== Motion (tiết chế — chỉ tạo điểm nhấn) ===== */
/* entrance hero: hiện dần + trồi nhẹ, so le bằng animation-delay */
.pk-rise { opacity: 0; animation: pkRise .8s cubic-bezier(.2,.7,.2,1) forwards; }
@keyframes pkRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

/* thẻ nổi trôi lơ lửng rất chậm (biên độ nhỏ) */
.pk-drift { animation: pkDrift 9s ease-in-out infinite; will-change: transform; }
@keyframes pkDrift { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

/* bóng trong cảnh sân nhấp nhô */
.pk-bob { animation: pkBob 3.2s ease-in-out infinite; }
@keyframes pkBob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }

/* pill LIVE phát nhịp vòng sáng đỏ */
.pk-live { animation: pkPing 2.2s cubic-bezier(.4,0,.6,1) infinite; }
@keyframes pkPing {
  0% { box-shadow: 0 0 0 0 rgba(229,72,77,.45); }
  70% { box-shadow: 0 0 0 8px rgba(229,72,77,0); }
  100% { box-shadow: 0 0 0 0 rgba(229,72,77,0); }
}

/* section hiện dần khi cuộn tới */
.pk-reveal { opacity: 0; transform: translateY(26px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
.pk-reveal-in { opacity: 1; transform: none; }

/* hover phản hồi nhẹ */
.pk-pill { transition: transform .2s ease, filter .2s ease; }
.pk-pill:hover { transform: translateY(-1.5px); filter: brightness(1.07); }
.pk-link svg { transition: transform .22s ease; }
.pk-link:hover svg { transform: translate(2px, -2px); }
.pk-brand svg { transition: transform .5s cubic-bezier(.3,.7,.3,1); }
.pk-brand:hover svg { transform: rotate(90deg); }

@media (prefers-reduced-motion: reduce) {
  .pk-rise, .pk-drift, .pk-bob, .pk-live, .pk-fade { animation: none !important; opacity: 1 !important; }
  .pk-reveal { opacity: 1; transform: none; transition: none; }
  .pk-pill, .pk-link svg, .pk-brand svg { transition: none; }
}
`;

const buildCss = () =>
  scopeToHost(resetCssRaw) +
  "\n" +
  scopeToHost(astryxCssRaw) +
  "\n" +
  scopeToHost(themeCssRaw) +
  "\n" +
  OVERRIDE +
  "\n" +
  EXTRA_CSS;

export default function ShadowFrame({ children, style }) {
  const hostRef = useRef(null);
  const [shadow, setShadow] = useState(null);
  // Theme sáng/tối: chỉ cần đổi attribute trên :host — CSS trong shadow đã
  // khai báo sẵn cả 2 nhánh (light-dark() + :host([data-pk-theme="light"])).
  const theme = usePkTheme();

  // Ẩn scrollbar của TRANG khi giao diện Astryx active (vẫn cuộn bình thường).
  // Scrollbar thuộc <html> (ngoài shadow) nên phải tiêm style vào document;
  // gỡ khi unmount => các trang cũ (?ui=v1) không bị ảnh hưởng.
  useEffect(() => {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-pk-noscrollbar", "");
    styleEl.textContent = `
      html { scrollbar-width: none; -ms-overflow-style: none; }
      html::-webkit-scrollbar, body::-webkit-scrollbar { width: 0; height: 0; display: none; }
    `;
    document.head.appendChild(styleEl);
    return () => styleEl.remove();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || shadow) return;
    const sr = host.shadowRoot || host.attachShadow({ mode: "open" });
    const css = buildCss();
    let applied = false;
    try {
      if ("adoptedStyleSheets" in Document.prototype && typeof CSSStyleSheet === "function") {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        sr.adoptedStyleSheets = [sheet];
        applied = true;
      }
    } catch (e) {
      applied = false;
    }
    if (!applied) {
      // Fallback (engine không hỗ trợ constructable stylesheet / @scope)
      const styleEl = document.createElement("style");
      styleEl.textContent = css;
      sr.appendChild(styleEl);
    }
    setShadow(sr);
  }, [shadow]);

  return (
    <div ref={hostRef} data-pk-theme={theme} style={{ display: "block", colorScheme: theme, ...style }}>
      {shadow ? createPortal(children, shadow) : null}
    </div>
  );
}
