import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang hồ sơ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import ProfileAstryx from "./astryx/ProfilePage.jsx";
import ProfileV1 from "./ProfileScreen.jsx";

const ProfileGate = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <ProfileAstryx /> : <ProfileV1 />}
    </Suspense>
  );
};
export default ProfileGate;
