import React from "react";
import BrowserStudio from "./BrowserStudio";

export default function LiveStudioPage() {
  const sp = new URLSearchParams(window.location.search);
  const matchId = sp.get("matchId") || "";
  const fbServer =
    sp.get("server") || "rtmps://live-api-s.facebook.com:443/rtmp/";
  const fbKey = sp.get("key") || "";
  const ws = sp.get("ws") || ""; // optional override

  return (
    <BrowserStudio
      matchId={matchId}
      fbServer={fbServer}
      fbKey={fbKey}
      wsUrl={ws || undefined}
      width={1280}
      height={720}
      overlayFps={8}
      outFps={30}
    />
  );
}
