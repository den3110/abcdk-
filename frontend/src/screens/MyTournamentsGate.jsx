import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang "Giải của tôi" Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import MyTournamentsAstryx from "./astryx/MyTournamentsPage.jsx";
import MyTournamentsV1 from "./MyTournaments.jsx";

const MyTournamentsGate = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <MyTournamentsAstryx /> : <MyTournamentsV1 />}
    </Suspense>
  );
};
export default MyTournamentsGate;
