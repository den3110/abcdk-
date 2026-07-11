import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang hồ sơ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
const ProfileAstryx = lazy(() => import("./astryx/ProfilePage.jsx"));
const ProfileV1 = lazy(() => import("./ProfileScreen.jsx"));

const ProfileGate = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <ProfileAstryx /> : <ProfileV1 />}
    </Suspense>
  );
};
export default ProfileGate;
