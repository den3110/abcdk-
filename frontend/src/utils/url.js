// utils/url.ts
export function toHttpsIfNotLocalhost(raw) {
  if (!raw) return raw;

  // data:, blob:, file: -> giữ nguyên
  if (/^(data|blob|file):/i.test(raw)) return raw;

  // Protocol-relative //cdn.example.com -> ép https
  if (raw.startsWith("//")) return "https:" + raw;

  // URL tương đối (/img.png, ./x.png) -> giữ nguyên
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return raw;

  try {
    const u = new URL(raw);

    const isLocalHost =
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "::1" ||
      u.hostname.endsWith(".local") ||
      /^10\./.test(u.hostname) ||
      /^192\.168\./.test(u.hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(u.hostname);

    if (u.protocol === "http:" && !isLocalHost) {
      u.protocol = "https:";
    }
    return u.toString();
  } catch {
    return raw; // nếu parse lỗi thì trả lại như cũ
  }
}
