import { Tv } from "lucide-react";

import { useGetEventLiveConfigQuery } from "../slices/eventLiveApiSlice.js";
import { A } from "../screens/astryx/ui.jsx";

/* Banner "Xem live giải đấu" cho giao diện v3 (shadow-safe, inline-style) — bản v3 của
   EventLiveBannerAstryx. Chỉ hiện khi eventLive được bật + đã cấu hình. */
export default function EventLiveBannerV3() {
  const { data } = useGetEventLiveConfigQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });
  if (!data?.enabled || !data?.configured) return null;
  const name = data.eventName || "Giải đấu đang diễn ra";

  return (
    <div className="v3-container" style={{ marginTop: 18, marginBottom: 2 }}>
      <A
        href="/live/event"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 18px",
          borderRadius: 18,
          textDecoration: "none",
          position: "relative",
          overflow: "hidden",
          background:
            "linear-gradient(110deg,#0b1220 0%,#7f1d1d 55%,#dc2626 130%)",
          border: "1px solid rgba(255,255,255,.14)",
          boxShadow: "0 10px 34px rgba(220,38,38,.30)",
        }}
      >
        {data.bannerImageUrl ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url(${data.bannerImageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              opacity: 0.26,
            }}
          />
        ) : null}
        <div
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 11px",
            borderRadius: 10,
            background: "rgba(0,0,0,.35)",
            color: "#fff",
            fontWeight: 800,
            fontSize: 12.5,
            letterSpacing: 1,
          }}
        >
          <span
            className="pk-live-dot-v3"
            style={{ width: 9, height: 9, borderRadius: 999, background: "#ff2d2d", boxShadow: "0 0 8px #ff2d2d" }}
          />
          LIVE
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <div
            style={{
              color: "#fff",
              fontWeight: 800,
              fontSize: 18,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </div>
          <div style={{ color: "rgba(255,255,255,.86)", fontSize: 13.5, marginTop: 3 }}>
            Xem trực tiếp nhiều sân · nhiều góc camera ngay trên PickleTour
          </div>
        </div>
        <div
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "#fff",
            color: "#dc2626",
            fontWeight: 800,
            fontSize: 14.5,
            padding: "10px 16px",
            borderRadius: 12,
            whiteSpace: "nowrap",
          }}
        >
          <Tv size={17} /> Xem trực tiếp
        </div>
        <style>{`@keyframes pkLiveDotV3{0%{opacity:1}50%{opacity:.35}100%{opacity:1}} .pk-live-dot-v3{animation:pkLiveDotV3 1.2s infinite}`}</style>
      </A>
    </div>
  );
}
