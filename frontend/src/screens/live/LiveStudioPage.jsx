import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
// import BrowserStudio from "../../components/BrowserStudio";
import SEOHead from "../../components/SEOHead";
import ScoreOverlay from "../PickleBall/ScoreOverlay";
import FacebookLiveStreamerMUI from "../../components/FacebookLiveStreamer/FacebookLiveStreamerMUI";
import { useLanguage } from "../../context/LanguageContext";
import { useRegisterChatBotPageContext } from "../../context/ChatBotPageContext.jsx";

export default function LiveStudioPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const sp = new URLSearchParams(window.location.search);

  const matchId = sp.get("matchId") || "";
  const fbServer =
    sp.get("server") || "rtmps://live-api-s.facebook.com:443/rtmp/";
  const fbKey = sp.get("key") || "";

  // apiUrl: .env full -> .env base -> same-origin
  const apiUrl = useMemo(() => {
    const full = import.meta.env.VITE_API_URL + "/api/overlay/match";
    console.log(full);
    if (full) return full.replace(/\/+$/, "");

    const apiBase = import.meta.env.VITE_API_URL;

    if (apiBase) return `${apiBase.replace(/\/+$/, "")}/api/overlay/match`;

    return `${import.meta.env.VITE_API_URL}/api/overlay/match`;
  }, []);

  const overlayUrl = `${window.location.origin}/overlay/score?matchId=${matchId}&theme=dark&size=md&showSets=1&autoNext=1`;
  const chatBotSnapshot = useMemo(
    () => ({
      pageType: "live_studio",
      entityTitle: matchId ? `Trận ${matchId}` : t("liveStudio.seoTitle"),
      sectionTitle: "Studio phát trực tiếp",
      pageSummary:
        "Trang studio phát trực tiếp với overlay tỷ số và cấu hình RTMP cho trận hiện tại.",
      activeLabels: [
        matchId ? `Match ID: ${matchId}` : "Chưa chọn trận",
        fbKey ? "Đã cấu hình stream key" : "Chưa cấu hình stream key",
      ],
      visibleActions: ["Mở overlay tỷ số", "Thiết lập RTMP", "Phát trực tiếp"],
      highlights: [overlayUrl],
      metrics: [
        `RTMP: ${fbServer.replace(/^rtmps?:\/\//i, "").replace(/\/+$/, "")}`,
        "Độ phân giải: 1280×720",
        "Output FPS: 30",
      ],
    }),
    [matchId, t, fbKey, overlayUrl, fbServer],
  );

  const updateSearchParam = useCallback(
    (key, value) => {
      const next = new URLSearchParams(window.location.search);
      if (value === null || value === undefined || value === "") {
        next.delete(key);
      } else {
        next.set(key, String(value));
      }
      const search = next.toString();
      navigate(`${window.location.pathname}${search ? `?${search}` : ""}`);
    },
    [navigate],
  );

  const chatBotActionHandlers = useMemo(
    () => ({
      matchId: (nextValue) => updateSearchParam("matchId", nextValue),
      server: (nextValue) => updateSearchParam("server", nextValue),
      streamKey: (nextValue) => updateSearchParam("key", nextValue),
    }),
    [updateSearchParam],
  );

  useRegisterChatBotPageContext({
    snapshot: chatBotSnapshot,
    capabilityKeys: [
      "set_query_param",
      "set_page_state",
      "focus_element",
      "copy_link",
      "open_new_tab",
      "navigate",
    ],
    actionHandlers: chatBotActionHandlers,
  });

  return (
    <>
      <SEOHead title={t("liveStudio.seoTitle")} noIndex={true} />
      {/* <BrowserStudio
        matchId={matchId}
        fbServer={fbServer}
        fbKey={fbKey}
        // wsUrl={wsUrl}
        apiUrl={apiUrl}
        width={1280}
        height={720}
        overlayFps={8}
        outFps={30}
        overlayComponent={ScoreOverlay}
        overlayUrl={overlayUrl}
      /> */}
      <FacebookLiveStreamerMUI
        matchId={matchId}
        fbServer={fbServer}
        fbKey={fbKey}
        // wsUrl={wsUrl}
        apiUrl={apiUrl}
        width={1280}
        height={720}
        overlayFps={8}
        outFps={30}
        overlayComponent={ScoreOverlay}
        overlayUrl={overlayUrl}
      />
    </>
  );
}
