import PropTypes from "prop-types";

import { useLanguage } from "../context/LanguageContext.jsx";
import AppBootSplash from "./AppBootSplash.jsx";
import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";

export default function AppInitGate({ children }) {
  const { t } = useLanguage();
  const { data, error } = useGetAppInitQuery();

  if (!data && !error) {
    return (
      <AppBootSplash
        message={t("common.states.loading", {}, "Đang tải...")}
      />
    );
  }

  return children;
}

AppInitGate.propTypes = {
  children: PropTypes.node.isRequired,
};
