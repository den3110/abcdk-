// services/sportconnect.service.js
import axios from "axios";
import proxyManager from "./proxy.manager.js";

/**
 * ENV (tuỳ chọn):
 * SPORTCONNECT_COOKIE=__RequestVerificationToken=...; ASP.NET_SessionId=...; tk=...
 * SPORTCONNECT_ACCEPT_LANG=vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7
 * SPORTCONNECT_UA=<user agent custom>           // nếu đặt sẽ dùng cố định
 * SPORTCONNECT_SPOOF_IP=1                       // bật thêm X-Forwarded-For ngẫu nhiên
 * SPORTCONNECT_ORIGIN=https://sportconnect.vn   // tuỳ biến nếu cần
 * SPORTCONNECT_REFERER_BASE=https://sportconnect.vn/?sportType= // + sportId
 */
const endpoint = "https://sportconnect.vn/LevelPoint/List";

const ORIGIN = process.env.SPORTCONNECT_ORIGIN || "https://sportconnect.vn";
const REFERER_BASE =
  process.env.SPORTCONNECT_REFERER_BASE ||
  "https://sportconnect.vn/?sportType=";

const TRANSIENT_STATUS = new Set([429, 407]);
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ERR_SOCKET_CLOSED",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function isTransientStatus(s) {
  return s >= 500 || TRANSIENT_STATUS.has(s);
}
function isTransientError(err) {
  const code = err?.code || err?.errno;
  if (TRANSIENT_CODES.has(code)) return true;
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("timeout") || msg.includes("timed out");
}

/* ===================== Dynamic header helpers ===================== */
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function buildRandomIPv4() {
  // né private ranges
  const octet = () => randInt(1, 254);
  let a = octet();
  // tránh 10.x, 127.x, 169.254.x, 172.16-31.x, 192.168.x
  while (a === 10 || a === 127 || a === 169 || a === 172 || a === 192) {
    a = octet();
  }
  const b = octet();
  const c = octet();
  const d = octet();
  return `${a}.${b}.${c}.${d}`;
}

function buildUA() {
  // 1) Nếu ENV định nghĩa → dùng cố định
  if (process.env.SPORTCONNECT_UA) return process.env.SPORTCONNECT_UA.trim();

  // 2) Random Chrome Desktop/Mobile versions realistic
  const chromeMajor = randInt(120, 128);
  const safariBuild = `${randInt(600, 605)}.${randInt(1, 50)}.${randInt(
    1,
    50
  )}`;

  const platforms = [
    {
      // Windows 10/11
      label: "Windows",
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${randInt(
        1000,
        6000
      )}.0 Safari/537.36`,
      mobile: false,
    },
    {
      // macOS 13-14 Intel
      label: "macOS",
      ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_${randInt(
        14,
        15
      )}_${randInt(
        0,
        6
      )}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${randInt(
        1000,
        6000
      )}.0 Safari/537.36`,
      mobile: false,
    },
    {
      // Android 12-14
      label: "Android",
      ua: `Mozilla/5.0 (Linux; Android ${randInt(12, 14)}; Pixel ${randInt(
        4,
        8
      )}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.${randInt(
        1000,
        6000
      )}.0 Mobile Safari/537.36`,
      mobile: true,
    },
  ];
  return pick(platforms).ua;
}

function makeSecChUa(ua) {
  // Lấy version từ UA để đồng bộ
  const m = String(ua).match(/Chrome\/(\d+)\./i);
  const v = m ? m[1] : String(randInt(120, 128));
  // Nhiều site chỉ check chuỗi gần đúng — giữ dạng chuẩn phổ biến
  return `"Not.A/Brand";v="8", "Chromium";v="${v}", "Google Chrome";v="${v}"`;
}

function platformFromUA(ua) {
  const s = ua.toLowerCase();
  if (s.includes("android")) return { plat: "Android", mobile: "?1" };
  if (s.includes("macintosh")) return { plat: "macOS", mobile: "?0" };
  if (s.includes("windows")) return { plat: "Windows", mobile: "?0" };
  return { plat: "Unknown", mobile: "?0" };
}

function buildHeaders({ cookie, sportId }) {
  const ua = buildUA();
  const { plat, mobile } = platformFromUA(ua);
  const secChUa = makeSecChUa(ua);

  const acceptLang =
    process.env.SPORTCONNECT_ACCEPT_LANG ||
    "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7";

  const hdr = {
    accept: "application/json, text/javascript, */*; q=0.01",
    "accept-language": acceptLang,
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    origin: ORIGIN,
    priority: "u=1, i",
    referer: `${REFERER_BASE}${encodeURIComponent(String(sportId ?? 2))}`,
    "sec-ch-ua": secChUa,
    "sec-ch-ua-mobile": mobile,
    "sec-ch-ua-platform": `"${plat}"`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": String(randInt(0, 1)), // 0/1 ngẫu nhiên
    "user-agent": ua,
    "x-requested-with": "XMLHttpRequest",
    ...(cookie ? { cookie } : {}),
  };

  // Spoof thêm IP (optional)
  if (process.env.SPORTCONNECT_SPOOF_IP === "1") {
    hdr["x-forwarded-for"] = buildRandomIPv4();
    hdr["x-real-ip"] = buildRandomIPv4();
  }
  return hdr;
}

/* ===================== Axios call (1 attempt) ===================== */
async function postOnce({ agent, url, headers, data, signal }) {
  try {
    const res = await axios.post(endpoint, data, {
      headers,
      timeout: 20000,
      httpAgent: agent,
      httpsAgent: agent,
      proxy: false,
      validateStatus: () => true,
      signal,
    });
    return { ok: true, res, proxyUrl: url };
  } catch (err) {
    return { ok: false, err, proxyUrl: url };
  }
}

/**
 * Gọi LevelPoint/List qua proxy hiện thời (manager cập nhật mỗi 1s)
 * @param {Object} opt
 * @param {string} opt.searchCriterial
 * @param {number|string} [opt.sportId=2]
 * @param {number|string} [opt.page=0]
 * @param {string} [opt.waitingInformation=""]
 * @param {string} [opt.cookie=process.env.SPORTCONNECT_COOKIE]
 * @param {AbortSignal} [opt.signal]
 * @param {Object} [opt.headersOverride]  // 👈 cho phép ép header tuỳ biến
 * @returns {Promise<{status:number, data:any, headers:any, proxyUrl?:string, scheme?:string, error?:string}>}
 */
export async function listLevelPoint(opt = {}) {
  const {
    searchCriterial,
    sportId = 2,
    page = 0,
    waitingInformation = "",
    cookie = process.env.SPORTCONNECT_COOKIE,
    signal,
    headersOverride,
  } = opt;

  const body = new URLSearchParams({
    sportId: String(sportId ?? ""),
    page: String(page ?? ""),
    // giữ nguyên chuỗi; chỉ trim đầu/cuối — bên trong vẫn có dấu cách
    searchCriterial:
      typeof searchCriterial === "string"
        ? searchCriterial.trim()
        : String(searchCriterial ?? ""),
    waitingInformation: String(waitingInformation ?? ""),
  }).toString();

  // 🔁 Headers “dynamic” mỗi lần gọi
  const headers = {
    ...buildHeaders({ cookie, sportId }),
    ...(headersOverride || {}),
  };

  // Lấy agent hiện tại ( xoay socks5/http round-robin )
  let pickA = proxyManager.getAgent();
  if (!pickA) {
    const info = proxyManager.currentInfo();
    return {
      status: 0,
      data: null,
      headers: {},
      error:
        info.lastStatus === 101
          ? `Proxy cooldown ~${info.cooldownSec}s`
          : "Proxy not ready",
    };
  }

  // Attempt 1
  let { ok, res, err, proxyUrl } = await postOnce({
    agent: pickA.agent,
    url: pickA.url,
    headers,
    data: body,
    signal,
  });

  if (ok && res && !isTransientStatus(res.status)) {
    return {
      status: res.status,
      data: res.data,
      headers: res.headers,
      proxyUrl,
      scheme: pickA.scheme,
    };
  }
  if (!ok && !isTransientError(err)) {
    return {
      status: 0,
      data: null,
      headers: {},
      proxyUrl,
      scheme: pickA.scheme,
      error: err?.message || "Request failed",
    };
  }

  // Attempt 2: xoay agent tiếp theo (nếu chỉ có 1, dùng lại)
  const pickB = proxyManager.getAgent() || pickA;
  ({ ok, res, err, proxyUrl } = await postOnce({
    agent: pickB.agent,
    url: pickB.url,
    headers, // vẫn dynamic như trên (không cần đổi UA giữa 2 attempt)
    data: body,
    signal,
  }));

  if (ok && res) {
    return {
      status: res.status,
      data: res.data,
      headers: res.headers,
      proxyUrl,
      scheme: pickB.scheme,
    };
  }
  return {
    status: 0,
    data: null,
    headers: {},
    proxyUrl,
    scheme: pickB.scheme,
    error: err?.message || "All attempts failed",
  };
}

const SportConnectService = { listLevelPoint };
export default SportConnectService;
