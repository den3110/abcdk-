/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import PropTypes from "prop-types";
import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/vi";

import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  translateMessage,
} from "../i18n";

const STORAGE_KEY = "app-language";

const LanguageContext = createContext({
  language: DEFAULT_LANGUAGE,
  locale: "vi-VN",
  dayjsLocale: "vi",
  ogLocale: "vi_VN",
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key, _values, fallback) => fallback || key,
});

function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

function detectInitialLanguage() {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (SUPPORTED_LANGUAGES.includes(saved)) {
      return saved;
    }

    const browserLanguages = Array.isArray(window.navigator?.languages)
      ? window.navigator.languages
      : [window.navigator?.language];

    const match = browserLanguages
      .map((item) => String(item || "").toLowerCase())
      .find((item) => item.startsWith("en") || item.startsWith("vi"));

    if (match?.startsWith("en")) return "en";
    if (match?.startsWith("vi")) return "vi";
  }

  return DEFAULT_LANGUAGE;
}

export const useLanguage = () => useContext(LanguageContext);

export const LanguageContextProvider = ({ children }) => {
  const [language, setLanguageState] = useState(detectInitialLanguage);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, language);
    }

    dayjs.locale(language);

    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  const setLanguage = useCallback((nextLanguage) => {
    setLanguageState((current) =>
      normalizeLanguage(
        typeof nextLanguage === "function" ? nextLanguage(current) : nextLanguage
      )
    );
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => (current === "vi" ? "en" : "vi"));
  }, []);

  const t = useCallback(
    (key, values = {}, fallback) =>
      translateMessage(language, key, values, fallback),
    [language]
  );

  const contextValue = useMemo(
    () => ({
      language,
      locale: language === "en" ? "en-US" : "vi-VN",
      dayjsLocale: language === "en" ? "en" : "vi",
      ogLocale: language === "en" ? "en_US" : "vi_VN",
      setLanguage,
      toggleLanguage,
      t,
    }),
    [language, setLanguage, t, toggleLanguage]
  );

  return (
    <LanguageContext.Provider value={contextValue}>
      {children}
    </LanguageContext.Provider>
  );
};

LanguageContextProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export default LanguageContext;
