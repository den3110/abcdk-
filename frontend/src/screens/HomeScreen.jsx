import { Suspense } from "react";

import Hero from "../components/Hero";
import EventLiveBanner from "../components/EventLiveBanner";
import useAstryxUi from "../hook/useAstryxUi.js";
import useFrontendUiVersion from "../hook/useFrontendUiVersion.js";

// Trang chủ: Astryx chính là bản "v2" trong cài đặt hệ thống (frontendUi.version);
// v1 (hoặc ?ui=v1) -> Hero cũ. HomeScreenV2 (bản modern trước Astryx) không còn
// trong gate — giữ file lại phòng cần tham khảo. Override thử nghiệm: ?ui=v1|v2|v3.
import HomeScreenAstryx from "./HomeScreenAstryx.jsx";
import SportHomePage from "./v3/SportHomePage.jsx";

const HomeScreen = () => {
  const astryx = useAstryxUi();
  const { isV3Version } = useFrontendUiVersion();

  if (!astryx)
    return (
      <>
        <EventLiveBanner />
        <Hero />
      </>
    );

  if (isV3Version) {
    return (
      <Suspense fallback={null}>
        <SportHomePage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <HomeScreenAstryx />
    </Suspense>
  );
};
export default HomeScreen;
