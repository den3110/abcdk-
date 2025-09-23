// services/sportconnect.service.js
import axios from "axios";
import proxyManager from "./proxy.manager.js";

/**
 * ENV:
 * SPORTCONNECT_COOKIE=__RequestVerificationToken=...; ASP.NET_SessionId=...; tk=...
 */
const endpoint = "https://sportconnect.vn/LevelPoint/List";

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
 * Gọi LevelPoint/List qua proxy hiện thời (manager luôn cập nhật “mới nhất” mỗi 1s)
 * @param {Object} opt
 * @param {string} opt.searchCriterial
 * @param {number|string} [opt.sportId=2]
 * @param {number|string} [opt.page=0]
 * @param {string} [opt.waitingInformation=""]
 * @param {string} [opt.cookie=process.env.SPORTCONNECT_COOKIE]
 * @param {AbortSignal} [opt.signal]
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
  } = opt;

  const body = new URLSearchParams({
    sportId: String(sportId ?? ""),
    page: String(page ?? ""),
    // giữ nguyên chuỗi, chỉ trim đầu/cuối — bên trong vẫn có dấu cách
    searchCriterial:
      typeof searchCriterial === "string"
        ? searchCriterial.trim()
        : String(searchCriterial ?? ""),
    waitingInformation: String(waitingInformation ?? ""),
  }).toString();

  const headers = {
    accept: "application/json, text/javascript, */*; q=0.01",
    "accept-language": "en-US,en;q=0.8",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    origin: "https://sportconnect.vn",
    priority: "u=1, i",
    referer: "https://sportconnect.vn/?sportType=2",
    "sec-ch-ua": `"Chromium";v="140", "Not=A?Brand";v="24", "Brave";v="140"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"macOS"`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-gpc": "1",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
    ...(cookie ? { cookie } : {}),
  };

  // Lấy agent hiện tại ( đã xoay socks5/http theo round-robin )
  let pick = proxyManager.getAgent();
  if (!pick) {
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
    agent: pick.agent,
    url: pick.url,
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
      scheme: pick.scheme,
    };
  }
  if (!ok && !isTransientError(err)) {
    return {
      status: 0,
      data: null,
      headers: {},
      proxyUrl,
      scheme: pick.scheme,
      error: err?.message || "Request failed",
    };
  }

  // Attempt 2: xoay sang agent kế tiếp (HTTP <-> SOCKS5). Nếu chỉ có 1 candidate, vẫn dùng lại.
  const pick2 = proxyManager.getAgent() || pick;
  ({ ok, res, err, proxyUrl } = await postOnce({
    agent: pick2.agent,
    url: pick2.url,
    headers,
    data: body,
    signal,
  }));

  if (ok && res) {
    return {
      status: res.status,
      data: res.data,
      headers: res.headers,
      proxyUrl,
      scheme: pick2.scheme,
    };
  }
  return {
    status: 0,
    data: null,
    headers: {},
    proxyUrl,
    scheme: pick2.scheme,
    error: err?.message || "All attempts failed",
  };
}

const SportConnectService = { listLevelPoint };
export default SportConnectService;
