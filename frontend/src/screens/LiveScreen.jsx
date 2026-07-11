import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Trực tiếp Astryx (feed dọc kiểu TikTok) là MẶC ĐỊNH; ?ui=v1 ra trang cũ.
const LivePageAstryx = lazy(() => import("./astryx/LivePage.jsx"));
const LiveFeedPageV1 = lazy(() => import("./live/LiveFeedPage.jsx"));

const LiveScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <LivePageAstryx /> : <LiveFeedPageV1 />}
    </Suspense>
  );
};
export default LiveScreen;
