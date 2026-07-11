import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Trực tiếp Astryx (feed dọc kiểu TikTok) là MẶC ĐỊNH; ?ui=v1 ra trang cũ.
import LivePageAstryx from "./astryx/LivePage.jsx";
import LiveFeedPageV1 from "./live/LiveFeedPage.jsx";

const LiveScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <LivePageAstryx /> : <LiveFeedPageV1 />}
    </Suspense>
  );
};
export default LiveScreen;
