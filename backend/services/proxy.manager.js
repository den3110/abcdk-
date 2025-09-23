// services/proxy.manager.js
import axios from "axios";
import EventEmitter from "events";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

/**
 * ENV:
 * PROXYXOAY_URL=https://proxyxoay.shop/api/get.php?key=nuGvmetxvzNDsleYriywDh&nhamang=Random&tinhthanh=0
 * PROXY_POLL_MS=1000
 * PROXY_DEBUG=0|1
 */
const PROXY_API_URL =
  process.env.PROXYXOAY_URL ||
  "https://proxyxoay.shop/api/get.php?key=nuGvmetxvzNDsleYriywDh&nhamang=Random&tinhthanh=0";
const POLL_MS = Number(process.env.PROXY_POLL_MS || 1000);
const DEBUG = process.env.PROXY_DEBUG === "1";

function toProxyUrl(raw, scheme) {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || /^socks5h?:\/\//i.test(raw)) return raw;
  const [host, port, user, pass] = String(raw).trim().split(":");
  if (!host || !port) return null;
  if (!user || !pass) return `${scheme}://${host}:${port}`;
  return `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(
    pass
  )}@${host}:${port}`;
}
function parseSec(s = "") {
  const m = String(s).match(/(\d+)\s*s/i);
  return m ? Number(m[1]) : 0;
}

export class ProxyManager extends EventEmitter {
  constructor({ apiUrl = PROXY_API_URL, pollMs = POLL_MS } = {}) {
    super();
    this.apiUrl = apiUrl;
    this.pollMs = pollMs;
    this._timer = null;

    // trạng thái
    this.revision = 0;
    this.candidates = []; // [{scheme:'socks5'|'http', url, agent}]
    this._rr = 0; // round-robin index (KHÔNG reset khi có proxy mới)
    this._lastKey = ""; // để phát hiện cặp proxy đã đổi chưa
    this._hasNew = false; // true khi vừa nhận proxy mới (ưu tiên pick ở lần getAgent kế tiếp)
    this._lastRevisionServed = 0; // revision đã phục vụ new-pick

    this.lastStatus = null;
    this.lastMessage = "";
    this.cooldownSec = 0;
  }

  start() {
    if (this._timer) return;
    const tick = async () => {
      try {
        // cache buster + no-cache headers để né CDN
        const url =
          this.apiUrl +
          (this.apiUrl.includes("?") ? "&" : "?") +
          `_t=${Date.now()}`;
        const { data } = await axios.get(url, {
          timeout: 15000,
          proxy: false,
          validateStatus: () => true,
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });

        this.lastStatus = Number(data?.status ?? -1);
        this.lastMessage = String(data?.message || "");

        if (this.lastStatus === 101) {
          this.cooldownSec =
            parseSec(this.lastMessage) || this.cooldownSec || 1;
          if (DEBUG)
            console.log(`[ProxyManager] 101 cooldown ~${this.cooldownSec}s`);
          // không thay candidates
        } else if (this.lastStatus === 100) {
          this.cooldownSec = 0;
          const httpUrl = toProxyUrl(data?.proxyhttp, "http");
          const socksUrl = toProxyUrl(data?.proxysocks5, "socks5h");

          const newItems = [];
          if (socksUrl)
            newItems.push({
              scheme: "socks5",
              url: socksUrl,
              agent: new SocksProxyAgent(socksUrl),
            });
          if (httpUrl)
            newItems.push({
              scheme: "http",
              url: httpUrl,
              agent: new HttpsProxyAgent(httpUrl),
            });

          if (newItems.length) {
            const key = [socksUrl || "", httpUrl || ""].join("|");
            if (key !== this._lastKey) {
              // ✅ có proxy mới thật sự
              this._lastKey = key;
              this.candidates = newItems;

              // KHÔNG reset this._rr  ← yêu cầu của bạn
              this.revision += 1;
              this._hasNew = true; // cho lần getAgent kế tiếp dùng ngay proxy mới
              if (DEBUG) {
                console.log(
                  `[ProxyManager] update#${this.revision} (no rr reset)`
                );
                newItems.forEach((it) =>
                  console.log("  ->", it.scheme, it.url)
                );
              }
              this.emit("update", { revision: this.revision, items: newItems });
            } else {
              // giá trị giống lần trước → giữ nguyên, không đổi rr
              if (DEBUG) {
                // im lặng cho đỡ ồn; bật thì uncomment:
                // console.log("[ProxyManager] 100 but same key (no change)");
              }
            }
          }
        } else {
          if (DEBUG)
            console.log(
              `[ProxyManager] unexpected status=${this.lastStatus} msg=${this.lastMessage}`
            );
        }
      } catch (e) {
        this.lastStatus = -1;
        this.lastMessage = e?.message || "proxy api error";
        if (DEBUG) console.warn("[ProxyManager] error:", this.lastMessage);
      } finally {
        this._timer = setTimeout(tick, this.pollMs);
      }
    };
    tick();
  }

  stop() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  /**
   * Lấy agent hiện có.
   * - Nếu vừa có proxy mới (revision > lastRevisionServed): trả proxy mới *ngay lần này* (ưu tiên candidates[0]),
   *   set lastRevisionServed = revision, tắt hasNew. Không đụng round-robin.
   * - Nếu không có cập nhật mới: dùng round-robin bình thường.
   * @returns {{scheme:string,url:string,agent:any,revision:number}|null}
   */
  getAgent() {
    const N = this.candidates.length;
    if (!N) return null;

    if (this._hasNew && this.revision > this._lastRevisionServed) {
      // pick proxy mới ngay lập tức 1 lần
      const newest = this.candidates[0];
      this._lastRevisionServed = this.revision;
      this._hasNew = false;
      if (DEBUG)
        console.log("[ProxyManager] pick NEW:", newest.scheme, newest.url);
      return { ...newest, revision: this.revision };
    }

    // round-robin bình thường, KHÔNG reset rr khi có proxy mới
    const pick = this.candidates[this._rr % N];
    this._rr = (this._rr + 1) % (N || 1);
    if (DEBUG) console.log("[ProxyManager] pick RR:", pick.scheme, pick.url);
    return { ...pick, revision: this.revision };
  }

  currentInfo() {
    return {
      revision: this.revision,
      lastStatus: this.lastStatus,
      lastMessage: this.lastMessage,
      cooldownSec: this.cooldownSec,
      rrIndex: this._rr,
      hasNew: this._hasNew,
      candidates: this.candidates.map((c) => ({
        scheme: c.scheme,
        url: c.url,
      })),
    };
  }
}

// Singleton
const proxyManager = new ProxyManager();
proxyManager.start();

export default proxyManager;
