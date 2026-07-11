import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Hỗ trợ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import SupportAstryx from "./astryx/SupportPage.jsx";
import SupportV1 from "./SupportCenter.jsx";

const SupportGate = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <SupportAstryx /> : <SupportV1 />}
    </Suspense>
  );
};
export default SupportGate;
