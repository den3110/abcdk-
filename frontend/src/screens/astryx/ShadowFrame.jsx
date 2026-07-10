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
  /* Ép DARK cố định — trang chủ Astryx dùng nền tối #111112 */
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
    <div ref={hostRef} style={{ display: "block", ...style }}>
      {shadow ? createPortal(children, shadow) : null}
    </div>
  );
}
