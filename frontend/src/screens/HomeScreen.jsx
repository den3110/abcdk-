import { Suspense } from "react";

import Hero from "../components/Hero";
import useAstryxUi from "../hook/useAstryxUi.js";

// Trang chủ: Astryx chính là bản "v2" trong cài đặt hệ thống (frontendUi.version);
// v1 (hoặc ?ui=v1) -> Hero cũ. HomeScreenV2 (bản modern trước Astryx) không còn
// trong gate — giữ file lại phòng cần tham khảo. Override thử nghiệm: ?ui=v1|v2.
import HomeScreenAstryx from "./HomeScreenAstryx.jsx";

const HomeScreen = () => {
  const astryx = useAstryxUi();

  if (!astryx) return <Hero />;

  return (
    <Suspense fallback={null}>
      <HomeScreenAstryx />
    </Suspense>
  );
};
export default HomeScreen;
