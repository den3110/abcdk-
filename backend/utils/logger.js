// utils/logger.js

export function logInfo(...args) {
  console.log("[avatar]", ...args);
}

export function logWarn(...args) {
  console.warn("[avatar][WARN]", ...args);
}

export function logError(...args) {
  console.error("[avatar][ERROR]", ...args);
}
