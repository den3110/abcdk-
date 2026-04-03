const DEVICE_ID_KEY = "pt:web:device-id";

let deviceIdCache = "";
let deviceNameCache = "";

function canUseWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function randomId() {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch (error) {
    console.log(error);
  }

  return `web_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function getDeviceId() {
  if (deviceIdCache) return deviceIdCache;
  if (!canUseWindow()) {
    deviceIdCache = "web-ssr";
    return deviceIdCache;
  }

  try {
    const existing = String(localStorage.getItem(DEVICE_ID_KEY) || "").trim();
    if (existing) {
      deviceIdCache = existing;
      return deviceIdCache;
    }

    const next = randomId();
    localStorage.setItem(DEVICE_ID_KEY, next);
    deviceIdCache = next;
    return deviceIdCache;
  } catch (error) {
    console.log(error);
  }

  deviceIdCache = randomId();
  return deviceIdCache;
}

export function getDeviceName() {
  if (deviceNameCache) return deviceNameCache;
  if (typeof navigator === "undefined") {
    deviceNameCache = "Web browser";
    return deviceNameCache;
  }

  const platform = String(
    navigator.userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      "Web browser",
  )
    .replace(/\s+/g, " ")
    .trim();

  const browser = String(navigator.userAgent || "")
    .replace(/\s+/g, " ")
    .trim();

  deviceNameCache = platform || browser || "Web browser";
  return deviceNameCache;
}

export function getDeviceIdentity() {
  return {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
  };
}
