import en from "./lang/en.js";
import vi from "./lang/vi.js";

export const DEFAULT_LANGUAGE = "vi";
export const SUPPORTED_LANGUAGES = ["vi", "en"];

export const messages = {
  vi,
  en,
};

const warnedKeys = new Set();

export function resolveMessage(dictionary, key) {
  return String(key || "")
    .split(".")
    .reduce(
      (current, segment) => (current ? current[segment] : undefined),
      dictionary,
    );
}

export function interpolate(template, values = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_match, key) => {
    const value = values[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function warnMissing(language, key, usedDefault) {
  if (!import.meta.env.DEV) return;

  const cacheKey = `${language}:${key}:${usedDefault ? "default" : "missing"}`;
  if (warnedKeys.has(cacheKey)) return;
  warnedKeys.add(cacheKey);

  if (usedDefault) {
    console.warn(
      `[i18n] Missing key "${key}" in "${language}", fell back to "${DEFAULT_LANGUAGE}".`,
    );
    return;
  }

  console.warn(
    `[i18n] Missing key "${key}" in "${language}" and default "${DEFAULT_LANGUAGE}".`,
  );
}

export function translateMessage(language, key, values = {}, fallback) {
  const activeDictionary = messages[language] || messages[DEFAULT_LANGUAGE];
  const activeResolved = resolveMessage(activeDictionary, key);

  if (activeResolved !== undefined) {
    return typeof activeResolved === "string"
      ? interpolate(activeResolved, values)
      : activeResolved;
  }

  const defaultResolved = resolveMessage(messages[DEFAULT_LANGUAGE], key);
  if (defaultResolved !== undefined) {
    warnMissing(language, key, true);
    return typeof defaultResolved === "string"
      ? interpolate(defaultResolved, values)
      : defaultResolved;
  }

  warnMissing(language, key, false);
  return fallback ?? key;
}
