import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";

import Hero from "../components/Hero";
import useFrontendUiVersion from "../hook/useFrontendUiVersion.js";
import HomeScreenV2 from "./HomeScreenV2.jsx";

// 🧪 Astryx (?ui=v2): lazy-load để CSS Astryx CHỈ tải khi bật thử nghiệm — v1 không đổi.
const HomeScreenAstryx = lazy(() => import("./HomeScreenAstryx.jsx"));

const HomeScreen = () => {
  const { isModernVersion } = useFrontendUiVersion();
  const [searchParams] = useSearchParams();

  const uiParam = String(searchParams.get("ui") || "").trim().toLowerCase();
  if (uiParam === "v2") {
    return (
      <Suspense fallback={null}>
        <HomeScreenAstryx />
      </Suspense>
    );
  }

  return isModernVersion ? <HomeScreenV2 /> : <Hero />;
};
export default HomeScreen;
