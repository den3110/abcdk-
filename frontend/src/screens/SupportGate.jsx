import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Hỗ trợ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
const SupportAstryx = lazy(() => import("./astryx/SupportPage.jsx"));
const SupportV1 = lazy(() => import("./SupportCenter.jsx"));

const SupportGate = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <SupportAstryx /> : <SupportV1 />}
    </Suspense>
  );
};
export default SupportGate;
