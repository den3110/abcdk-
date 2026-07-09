import { useSearchParams } from "react-router-dom";

import Hero from "../components/Hero";
import useFrontendUiVersion from "../hook/useFrontendUiVersion.js";
import HomeScreenV2 from "./HomeScreenV2.jsx";
import HomeScreenAstryx from "./HomeScreenAstryx.jsx";

const HomeScreen = () => {
  const { isModernVersion } = useFrontendUiVersion();
  const [searchParams] = useSearchParams();

  // 🧪 Giao diện thử nghiệm (Astryx): CHỈ hiện khi thêm ?ui=v2 vào URL.
  // Không có param -> giữ nguyên hành vi production hiện tại.
  const uiParam = String(searchParams.get("ui") || "").trim().toLowerCase();
  if (uiParam === "v2") {
    return <HomeScreenAstryx />;
  }

  return isModernVersion ? <HomeScreenV2 /> : <Hero />;
};
export default HomeScreen;
