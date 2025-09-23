// node proxy-sportconnect.js
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

/** 1) Lấy proxy từ API */
async function fetchProxyInfo() {
  const url =
    "https://proxyxoay.shop/api/get.php?key=%20nuGvmetxvzNDsleYriywDh&&nhamang=Random&&tinhthanh=0";
  const { data } = await axios.get(url, { timeout: 15000 });
  // data thường có { status, message, proxyhttp, proxysocks5, ... }
  return data;
}

/** Chuyển "ip:port:user:pass" -> URL có scheme */
function toProxyUrl(raw, scheme) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || /^socks5h?:\/\//i.test(raw)) return raw; // đã có scheme
  const [host, port, user, pass] = String(raw).split(":");
  if (!host || !port) return null;
  if (!user || !pass) return `${scheme}://${host}:${port}`;
  return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(
    pass
  )}@${host}:${port}`;
}

/** Tạo agent từ info proxy (ưu tiên socks5, fallback http) */
function makeProxyAgent(pInfo) {
  // Ưu tiên socks5 nếu có
  const socksUrl = toProxyUrl(pInfo?.proxysocks5, "socks5h");
  if (socksUrl) {
    return { url: socksUrl, agent: new SocksProxyAgent(socksUrl) };
  }
  // Fallback HTTP proxy
  const httpUrl = toProxyUrl(pInfo?.proxyhttp, "http");
  if (httpUrl) {
    return { url: httpUrl, agent: new HttpsProxyAgent(httpUrl) };
  }
  throw new Error("Không tìm thấy proxysocks5/proxyhttp trong phản hồi.");
}

/** 2) Gửi request giống curl (form-urlencoded) qua proxy */
async function callSportConnect(agent) {
  const endpoint = "https://sportconnect.vn/LevelPoint/List";

  // Body như curl:
  const params = new URLSearchParams({
    sportId: "2",
    page: "0",
    searchCriterial: "0888698383",
    waitingInformation: "",
  });

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
    // Cookie y hệt chuỗi trong curl
    cookie:
      "__RequestVerificationToken=9uNTld75AQBh_0v-IqUo7d7PNjtu8nvmUpeLdtvxkzTTxjKrn9t6e-RAkovy6SM4w63e6vJoDBB_rCpv5e3fUdtI-MJa56jxnievC1mKx9Y1; ASP.NET_SessionId=1md1014ni5uvztxf1lcbo00j; tk=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJJRCI6NDQ4NzUsIkhvVmFUZW4iOiJUcmnhu4d1IEh1eSBIb8OgbmciLCJOaWNrTmFtZSI6Ikhvw6BuZyBUcmnhu4d1IiwiQk9EIjoiMjAwMC0wNy0wMVQwMDowMDowMC4wMDBaIiwiU29EaWVuVGhvYWkiOiIwODY5OTQxNjI5IiwiaWF0IjoxNzU2OTA2NzA3LCJleHAiOjE3NTk0OTg3MDd9.Al_jKncTCccpQUw2pMTpb-_CdJXJFOfROsh_HrIRc5E",
  };

  const res = await axios.post(endpoint, params.toString(), {
    headers,
    timeout: 20000,
    // Dùng agent cho cả HTTP/HTTPS; tắt axios proxy mặc định
    httpAgent: agent,
    httpsAgent: agent,
    proxy: false,
    // Nếu server trả compressed thì axios tự handle
    validateStatus: () => true,
  });

  return res;
}

/** 3) Main: lấy proxy -> gọi API (retry 1 lần nếu die) */
(async function main() {
  try {
    const pInfo = await fetchProxyInfo();
    let { agent, url } = makeProxyAgent(pInfo);
    console.log("[proxy] using:", url);

    let res = await callSportConnect(agent);

    // Nếu proxy die/timeout/407/5xx, thử lấy proxy mới và retry 1 lần
    if (!res || res.status >= 500 || res.status === 407 || res.status === 429) {
      console.warn("[warn] first attempt failed with status:", res?.status);
      const p2 = await fetchProxyInfo();
      const alt = makeProxyAgent(p2);
      console.log("[proxy] retry with:", alt.url);
      res = await callSportConnect(alt.agent);
    }

    console.log("Status:", res.status);
    // In body (có thể là JSON hoặc HTML)
    console.log(
      typeof res.data === "string"
        ? res.data
        : JSON.stringify(res.data, null, 2)
    );
  } catch (err) {
    console.error("ERROR:", err?.message || err);
  }
})();
