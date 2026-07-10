/**
 * PickleWordmark — wordmark "pickletour" là SVG PATH THẬT convert từ font display Chango (OFL)
 * qua scripts/gen-wordmark.mjs (không render bằng text/font lúc runtime).
 * Mỗi chữ được đặt lệch baseline nhẹ (bounce) để có nhịp hand-lettering riêng.
 * Tô currentColor => đổi màu theo theme carousel. Muốn đổi dáng chữ: chạy lại script với font khác.
 */
import wordmarkData from "./wordmarkData.js";

const VIEWBOX = wordmarkData.viewBox;

export default function PickleWordmark({ id, style }) {
  return (
    <svg
      viewBox={VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="pickletour"
      style={{ display: "block", width: "100%", height: "auto", ...style }}
      fill="currentColor"
    >
      {wordmarkData.letters.map((l, i) => (
        <path key={`${id || "wm"}-${i}`} d={l.d} />
      ))}
    </svg>
  );
}
