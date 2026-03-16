import PropTypes from "prop-types";
import { LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

import { useLanguage } from "../context/LanguageContext.jsx";

export default function LocalizedDateProvider({ children }) {
  const { dayjsLocale } = useLanguage();

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={dayjsLocale}>
      {children}
    </LocalizationProvider>
  );
}

LocalizedDateProvider.propTypes = {
  children: PropTypes.node.isRequired,
};
