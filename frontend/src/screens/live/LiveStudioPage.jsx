import React, { useMemo } from "react";
import BrowserStudio from "./BrowserStudio";
import ScoreOverlay from "../PickleBall/ScoreOverlay";

export default function LiveStudioPage() {
  const sp = new URLSearchParams(window.location.search);

  const matchId = sp.get("matchId") || "";
  const fbServer =
    sp.get("server") || "rtmps://live-api-s.facebook.com:443/rtmp/";
  const fbKey = sp.get("key") || "";

  // KHÔNG lấy ws từ URL nữa
  const wsUrl = useMemo(() => {
    // 1) .env (Vite / CRA / Next)
    const env = import.meta?.env?.VITE_RTMP_WS_URL;
    if (env) return env;

    // 2) Fallback same-origin
    const origin = window.location.origin; // http://localhost:5173 | https://pickletour.vn
    const base = origin.startsWith("https")
      ? origin.replace(/^https/, "wss")
      : origin.replace(/^http/, "ws");
    return `${base}/ws/rtmp`;
  }, []);

  const overlayUrl = `${window.location.origin}/overlay/score?matchId=${matchId}&theme=dark&size=md&showSets=1&autoNext=1`;

  return (
    <BrowserStudio
      matchId={matchId}
      fbServer={fbServer}
      fbKey={fbKey}
      wsUrl={wsUrl}
      width={1280}
      height={720}
      overlayFps={8}
      outFps={30}
      overlayComponent={ScoreOverlay}
      overlayUrl={overlayUrl}
    />
  );
}
