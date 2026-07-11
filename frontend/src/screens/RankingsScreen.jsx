import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Bảng xếp hạng Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
const RankingsPageAstryx = lazy(() => import("./astryx/RankingsPage.jsx"));
const RankingListV1 = lazy(() => import("./PickleBall/RankingList.jsx"));

const RankingsScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <RankingsPageAstryx /> : <RankingListV1 />}
    </Suspense>
  );
};
export default RankingsScreen;
