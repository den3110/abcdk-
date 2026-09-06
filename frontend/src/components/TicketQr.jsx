/* eslint-disable react/prop-types */
// Vé điện tử: render QR (SVG) từ token — chủ sân quét để check-in.
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export const ticketQrPayload = (token) => `ptbk:${token}`;

export default function TicketQr({ token, size = 220 }) {
  const svg = useMemo(() => {
    if (!token) return null;
    const qr = qrcode(0, "M");
    qr.addData(ticketQrPayload(token));
    qr.make();
    const n = qr.getModuleCount();
    const cell = size / (n + 8); // quiet zone 4 ô mỗi bên
    const pad = cell * 4;
    let d = "";
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (qr.isDark(r, c)) {
          d += `M${(pad + c * cell).toFixed(2)} ${(pad + r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
        }
      }
    }
    return { d, size };
  }, [token, size]);

  if (!svg) return null;
  return (
    <svg width={svg.size} height={svg.size} viewBox={`0 0 ${svg.size} ${svg.size}`} shapeRendering="crispEdges" style={{ display: "block", background: "#fff", borderRadius: 12 }}>
      <path d={svg.d} fill="#000" />
    </svg>
  );
}
