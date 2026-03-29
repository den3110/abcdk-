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
const API_BASE_URL = String(import.meta.env.VITE_API_URL || "")
  .trim()
  .replace(/\/+$/, "");
const GEO_PROXY_URL = API_BASE_URL ? `${API_BASE_URL}/api/geo` : "/api/geo";
const GEO_LOOKUP_TIMEOUT_MS = 3500;

// ---- Bot / Crawler detection ----
function isBot() {
  if (typeof navigator === "undefined") return true;
  return /bot|crawl|spider|slurp|googlebot|bingbot|yandex|baidu|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram/i.test(
    navigator.userAgent,
  );
}

// ---- Detect language from browser settings (synchronous, instant) ----
function detectBrowserLanguage() {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  if (isBot()) return "vi";
  const langs = navigator.languages || [navigator.language || ""];
  for (const l of langs) {
    const code = String(l).toLowerCase().split("-")[0];
    if (SUPPORTED_LANGUAGES.includes(code)) return code;
  }
  return DEFAULT_LANGUAGE;
}

// ---- Async geo-lookup via backend proxy (for incognito / no stored pref) ----
let cachedGeoPromise = null;

function mapCountryToLanguage(countryCode) {
  const code = String(countryCode || "")
    .trim()
    .toUpperCase();
  if (code === "VN") return "vi";
  if (!code || code === "UNKNOWN") return DEFAULT_LANGUAGE;
  return "en";
}

async function resolveLanguageFromGeo() {
  if (isBot()) return "vi";
  if (!cachedGeoPromise) {
    cachedGeoPromise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEO_LOOKUP_TIMEOUT_MS);
      try {
        const res = await fetch(GEO_PROXY_URL, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error(`geo ${res.status}`);
        const data = await res.json();
        return mapCountryToLanguage(data?.country);
      } finally {
        clearTimeout(timer);
      }
    })().catch(() => {
      cachedGeoPromise = null;
      return DEFAULT_LANGUAGE;
    });
  }
  return cachedGeoPromise;
}

const LanguageContext = createContext({
  language: DEFAULT_LANGUAGE,
  locale: "vi-VN",
  dayjsLocale: "vi",
  ogLocale: "vi_VN",
  geoResolving: false,
  setLanguage: () => {},
  toggleLanguage: () => {},
  t: (key, _values, fallback) => fallback || key,
});

function normalizeLanguage(value) {
  return SUPPORTED_LANGUAGES.includes(value) ? value : DEFAULT_LANGUAGE;
}

function readStoredLanguagePreference() {
  if (typeof window === "undefined") {
    return { language: DEFAULT_LANGUAGE, source: AUTO_LANGUAGE_SOURCE };
  }

  const saved = window.localStorage.getItem(STORAGE_KEY);
  const source = window.localStorage.getItem(STORAGE_SOURCE_KEY);

  if (source === USER_LANGUAGE_SOURCE && SUPPORTED_LANGUAGES.includes(saved)) {
    return { language: saved, source: USER_LANGUAGE_SOURCE };
  }

  return { language: detectBrowserLanguage(), source: AUTO_LANGUAGE_SOURCE };
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

export const useLanguage = () => useContext(LanguageContext);

export const LanguageContextProvider = ({ children }) => {
  const [languageState, setLanguageState] = useState(
    readStoredLanguagePreference,
  );
  const geoStartedRef = useRef(false);
  const language = languageState.language;

  // Show loading indicator only when geo needs to resolve (no stored pref, not a bot)
  const needsGeo =
    languageState.source !== USER_LANGUAGE_SOURCE &&
    typeof window !== "undefined" &&
    !isBot();
  const [geoResolving, setGeoResolving] = useState(needsGeo);

  // Sync html lang & dayjs locale
  useEffect(() => {
    dayjs.locale(language);
    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
    }
  }, [language]);

  // Persist / clear localStorage
  useEffect(() => {
    if (languageState.source === USER_LANGUAGE_SOURCE) {
      persistUserLanguage(languageState.language);
      return;
    }
    clearStoredLanguagePreference();
  }, [languageState.language, languageState.source]);

  // Async geo refine — only for auto-detected users (incognito / first visit)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (languageState.source === USER_LANGUAGE_SOURCE) {
      setGeoResolving(false);
      return;
    }
    if (isBot()) {
      setGeoResolving(false);
      return;
    }

    geoStartedRef.current = true;
    let cancelled = false;

    resolveLanguageFromGeo()
      .then((geoLang) => {
        if (cancelled) return;
        setLanguageState((cur) => {
          if (cur.source === USER_LANGUAGE_SOURCE) return cur;
          if (cur.language === geoLang) return cur;
          return { language: geoLang, source: AUTO_LANGUAGE_SOURCE };
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setGeoResolving(false);
      });

    return () => {
      cancelled = true;
      geoStartedRef.current = false;
    };
  }, [languageState.source]);

  const setLanguage = useCallback((nextLanguage) => {
    setLanguageState((current) => ({
      language: normalizeLanguage(
        typeof nextLanguage === "function"
          ? nextLanguage(current.language)
          : nextLanguage,
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
    [language],
  );

  const contextValue = useMemo(
    () => ({
      language,
      locale: language === "en" ? "en-US" : "vi-VN",
      dayjsLocale: language === "en" ? "en" : "vi",
      ogLocale: language === "en" ? "en_US" : "vi_VN",
      geoResolving,
      setLanguage,
      toggleLanguage,
      t,
    }),
    [language, geoResolving, setLanguage, t, toggleLanguage],
  );

  return (
    <LanguageContext.Provider value={contextValue}>
      {geoResolving ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
          }}
        >
          <img
            src="/icon-512.png"
            alt="Loading"
            width={64}
            height={64}
            style={{ animation: "pulse 1.2s ease-in-out infinite" }}
          />
          <style>{`@keyframes pulse{0%,100%{opacity:.4;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}`}</style>
        </div>
      ) : null}
      <div
        style={
          geoResolving
            ? { visibility: "hidden", height: 0, overflow: "hidden" }
            : undefined
        }
      >
        {children}
      </div>
    </LanguageContext.Provider>
  );
};

LanguageContextProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export default LanguageContext;
