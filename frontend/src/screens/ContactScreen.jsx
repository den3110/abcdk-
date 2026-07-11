import { lazy, Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Liên hệ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
const ContactPageAstryx = lazy(() => import("./astryx/ContactPage.jsx"));
const ContactPageV1 = lazy(() => import("./Contact.jsx"));

const ContactScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <ContactPageAstryx /> : <ContactPageV1 />}
    </Suspense>
  );
};
export default ContactScreen;
