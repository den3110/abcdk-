import Hero from "../components/Hero";
import useFrontendUiVersion from "../hook/useFrontendUiVersion.js";
import HomeScreenV2 from "./HomeScreenV2.jsx";

const HomeScreen = () => {
  const { isModernVersion } = useFrontendUiVersion();

  return isModernVersion ? <HomeScreenV2 /> : <Hero />;
};
export default HomeScreen;
