import React, { useMemo } from "react";
import BrowserStudio from "./BrowserStudio";
import ScoreOverlay from "../PickleBall/ScoreOverlay";

export default function LiveStudioPage() {
  const sp = new URLSearchParams(window.location.search);

  const matchId = sp.get("matchId") || "";
  const fbServer =
    sp.get("server") || "rtmps://live-api-s.facebook.com:443/rtmp/";
  const fbKey = sp.get("key") || "";

  // wsUrl: .env -> same-origin
  const wsUrl = useMemo(() => {
    const env = import.meta?.env?.VITE_RTMP_WS_URL;
    if (env) return env;

    const origin = window.location.origin;
    const base = origin.startsWith("https")
      ? origin.replace(/^https/, "wss")
      : origin.replace(/^http/, "ws");
    return `${base}/ws/rtmp`;
  }, []);

  // apiUrl: .env full -> .env base -> same-origin
  const apiUrl = useMemo(() => {
    const full = import.meta.env.VITE_API_URL + "/api/overlay/match";
    console.log(full)
    if (full) return full.replace(/\/+$/, "");

    const apiBase = import.meta.env.VITE_API_URL

    if (apiBase) return `${apiBase.replace(/\/+$/, "")}/api/overlay/match`;

    return `${import.meta.env.VITE_API_URL}/api/overlay/match`;
  }, []);

  const overlayUrl = `${window.location.origin}/overlay/score?matchId=${matchId}&theme=dark&size=md&showSets=1&autoNext=1`;

  return (
    <BrowserStudio
      matchId={matchId}
      fbServer={fbServer}
      fbKey={fbKey}
      wsUrl={wsUrl}
      apiUrl={apiUrl}
      width={1280}
      height={720}
      overlayFps={8}
      outFps={30}
      overlayComponent={ScoreOverlay}
      overlayUrl={overlayUrl}
    />
  );
}
