export function toDate(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value, locale = "vi-VN", options = {}) {
  const date = toDate(value);
  if (!date) return "";

  return date.toLocaleDateString(locale, options);
}

export function formatTime(value, locale = "vi-VN", options = {}) {
  const date = toDate(value);
  if (!date) return "";

  return date.toLocaleTimeString(locale, options);
}

export function formatDateTime(value, locale = "vi-VN", options = {}) {
  const date = toDate(value);
  if (!date) return "";

  return date.toLocaleString(locale, options);
}

export function formatNumber(value, locale = "vi-VN", options = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";

  return new Intl.NumberFormat(locale, options).format(num);
}

export function getDateInputFormat(language = "vi") {
  return language === "en" ? "MM/DD/YYYY" : "DD/MM/YYYY";
}

export function getDateInputPlaceholder(language = "vi") {
  return getDateInputFormat(language);
}
