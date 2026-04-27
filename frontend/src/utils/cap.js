const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

const normalizeFlag = (value) =>
  TRUE_VALUES.has(String(value || "").trim().toLowerCase());

const normalizeUrl = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
};

export const CAP_ENABLED = normalizeFlag(import.meta.env.VITE_CAP_ENABLED);
export const CAP_API_ENDPOINT = normalizeUrl(import.meta.env.VITE_CAP_API_ENDPOINT);
export const CAP_WIDGET_SCRIPT_URL = String(
  import.meta.env.VITE_CAP_WIDGET_SCRIPT_URL || "",
).trim();
export const CAP_WASM_URL = String(import.meta.env.VITE_CAP_WASM_URL || "").trim();
