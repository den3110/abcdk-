import React from "react";
import BrowserStudio from "./BrowserStudio";
import ScoreOverlay from "../PickleBall/ScoreOverlay";

export default function LiveStudioPage() {
  const sp = new URLSearchParams(window.location.search);
  const matchId = sp.get("matchId") || "";
  const fbServer =
    sp.get("server") || "rtmps://live-api-s.facebook.com:443/rtmp/";
  const fbKey = sp.get("key") || "";
  const ws = sp.get("ws") || ""; // optional override
  const overlayUrl =
     window?.location?.origin
      ? `${window.location.origin}/overlay/score?matchId=${matchId}&theme=dark&size=md&showSets=1&autoNext=1`
      : "";

  return (
    <BrowserStudio
      matchId={matchId}
      fbServer={fbServer}
      fbKey={fbKey}
      // wsUrl={"wss://" + import.meta.env.HOST + "/ws/rtmp"}
      width={1280}
      height={720}
      overlayFps={8}
      outFps={30}
      overlayComponent={ScoreOverlay}
      overlayUrl={overlayUrl}
      // apiUrl={import.meta.env.VITE_API_URL+ "/api/overlay/match"}
    />
  );
}
