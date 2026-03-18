/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
const STORAGE_SOURCE_KEY = "app-language-source";
const USER_LANGUAGE_SOURCE = "user";
const AUTO_LANGUAGE_SOURCE = "auto";
const GEO_LOOKUP_URL = "https://api.country.is/";
const GEO_LOOKUP_TIMEOUT_MS = 3500;

let cachedGeoLanguagePromise = null;

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

function readStoredLanguagePreference() {
  if (typeof window === "undefined") {
    return {
      language: DEFAULT_LANGUAGE,
      source: AUTO_LANGUAGE_SOURCE,
    };
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  const source = window.localStorage.getItem(STORAGE_SOURCE_KEY);

  if (source === USER_LANGUAGE_SOURCE && SUPPORTED_LANGUAGES.includes(saved)) {
    return {
      language: saved,
      source: USER_LANGUAGE_SOURCE,
    };
  }

  return {
    language: DEFAULT_LANGUAGE,
    source: AUTO_LANGUAGE_SOURCE,
  };
}

function persistUserLanguage(language) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(STORAGE_KEY, language);
  window.localStorage.setItem(STORAGE_SOURCE_KEY, USER_LANGUAGE_SOURCE);
}

function clearStoredLanguagePreference() {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(STORAGE_SOURCE_KEY);
}

function mapCountryToLanguage(countryCode) {
  return String(countryCode || "").trim().toUpperCase() === "VN" ? "vi" : "en";
}

async function resolveLanguageFromCountryLookup() {
  if (!cachedGeoLanguagePromise) {
    cachedGeoLanguagePromise = (async () => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        GEO_LOOKUP_TIMEOUT_MS
      );

      try {
        const response = await fetch(GEO_LOOKUP_URL, {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(`Country lookup failed with status ${response.status}`);
        }

        const payload = await response.json();
        if (!payload || typeof payload.country !== "string") {
          throw new Error("Country lookup response is missing country");
        }

        return mapCountryToLanguage(payload.country);
      } finally {
        window.clearTimeout(timeoutId);
      }
    })().catch((error) => {
      cachedGeoLanguagePromise = null;
      throw error;
    });
  }

  return cachedGeoLanguagePromise;
}

export const useLanguage = () => useContext(LanguageContext);

export const LanguageContextProvider = ({ children }) => {
  const [languageState, setLanguageState] = useState(
    readStoredLanguagePreference
  );
  const autoDetectStartedRef = useRef(false);
  const languageSourceRef = useRef(languageState.source);
  const language = languageState.language;

  useEffect(() => {
    languageSourceRef.current = languageState.source;
  }, [languageState.source]);

  useEffect(() => {
    dayjs.locale(language);

    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  useEffect(() => {
    if (languageState.source === USER_LANGUAGE_SOURCE) {
      persistUserLanguage(languageState.language);
      return;
    }

    clearStoredLanguagePreference();
  }, [languageState.language, languageState.source]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (languageState.source === USER_LANGUAGE_SOURCE) return;
    if (autoDetectStartedRef.current) return;

    autoDetectStartedRef.current = true;
    let cancelled = false;

    resolveLanguageFromCountryLookup()
      .then((detectedLanguage) => {
        if (cancelled) return;
        if (languageSourceRef.current === USER_LANGUAGE_SOURCE) return;

        setLanguageState((current) => {
          if (current.source === USER_LANGUAGE_SOURCE) return current;
          if (current.language === detectedLanguage) return current;

          return {
            language: detectedLanguage,
            source: AUTO_LANGUAGE_SOURCE,
          };
        });
      })
      .catch(() => {
        // Keep Vietnamese as the safe default when geo lookup fails.
      });

    return () => {
      cancelled = true;
    };
  }, [languageState.source]);

  const setLanguage = useCallback((nextLanguage) => {
    setLanguageState((current) => ({
        language: normalizeLanguage(
          typeof nextLanguage === "function"
            ? nextLanguage(current.language)
            : nextLanguage
        ),
        source: USER_LANGUAGE_SOURCE,
      }));
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => ({
      language: current.language === "vi" ? "en" : "vi",
      source: USER_LANGUAGE_SOURCE,
    }));
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
