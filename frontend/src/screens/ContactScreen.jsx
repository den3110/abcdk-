import { Suspense } from "react";

import useAstryxUi from "../hook/useAstryxUi.js";

// Trang Liên hệ Astryx là MẶC ĐỊNH; bật/tắt theo cài đặt hệ thống (frontendUi.version) + override ?ui= (xem useAstryxUi).
import ContactPageAstryx from "./astryx/ContactPage.jsx";
import ContactPageV1 from "./Contact.jsx";

const ContactScreen = () => {
  const astryx = useAstryxUi();

  return (
    <Suspense fallback={null}>
      {astryx ? <ContactPageAstryx /> : <ContactPageV1 />}
    </Suspense>
  );
};
export default ContactScreen;
