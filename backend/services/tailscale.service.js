// Dịch vụ cấp "auth key" Tailscale cho Pickletour Network.
//
// Ý tưởng: user PickleTour được admin cấp quyền (hasNetworkAccess) sẽ được backend
// cấp MỘT auth key Tailscale dạng:
//   - ephemeral     → thiết bị tự biến mất khỏi tailnet khi offline (không rác)
//   - preauthorized → vào thẳng, admin không phải duyệt từng máy
//   - tagged        → gắn tag (vd tag:pickletour-net), KHÔNG gắn vào tài khoản
//                     Tailscale của ai → không cần tạo/duyệt từng tài khoản user
//   - reusable:false + hết hạn ngắn → mỗi phiên 1 key, hạn chế lạm dụng
// ACL trong Tailscale giới hạn tag này chỉ thấy đúng camera/máy live cần thiết.
//
// Xác thực với Tailscale API bằng OAuth client (khuyến nghị) HOẶC API key tĩnh.
// Tạo OAuth client tại: Tailscale admin console → Settings → OAuth clients
//   scope: "auth_keys" (write) + gán đúng tag owner cho tag:pickletour-net.
//
// ENV:
//   TAILSCALE_OAUTH_CLIENT_ID       OAuth client id   (ưu tiên)
//   TAILSCALE_OAUTH_CLIENT_SECRET   OAuth client secret
//   TAILSCALE_API_KEY               API key tĩnh (dùng khi không set OAuth)
//   TAILSCALE_TAILNET               tên tailnet, mặc định "-" (tailnet của client)
//   TAILSCALE_TAG                   tag gắn cho thiết bị, mặc định "tag:pickletour-net"
//   TAILSCALE_KEY_TTL_SECONDS       hạn auth key (giây), mặc định 3600
//   TAILSCALE_LOGIN_SERVER          control server (self-host Headscale), tuỳ chọn

const API_BASE = (process.env.TAILSCALE_API_BASE || "https://api.tailscale.com").replace(/\/+$/, "");
const TAILNET = process.env.TAILSCALE_TAILNET || "-";
const TAG = process.env.TAILSCALE_TAG || "tag:pickletour-net";
const KEY_TTL = Math.max(300, Number(process.env.TAILSCALE_KEY_TTL_SECONDS) || 3600);

// Cache bearer token OAuth (đổi được bằng env mỗi lần deploy; không ghi ra log).
let _tokenCache = { token: "", exp: 0 };

export function isConfigured() {
  return Boolean(
    (process.env.TAILSCALE_OAUTH_CLIENT_ID && process.env.TAILSCALE_OAUTH_CLIENT_SECRET) ||
      process.env.TAILSCALE_API_KEY,
  );
}

export function networkConfig() {
  return {
    tailnet: TAILNET,
    tag: TAG,
    keyTtlSeconds: KEY_TTL,
    loginServer: process.env.TAILSCALE_LOGIN_SERVER || "",
  };
}

async function fetchJson(url, opts, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!r.ok) {
      const msg = data?.message || data?.raw || `HTTP ${r.status}`;
      const err = new Error(String(msg).slice(0, 300));
      err.status = r.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Lấy bearer token: OAuth client_credentials (cache tới gần hết hạn) hoặc API key.
async function getAuthHeader() {
  if (process.env.TAILSCALE_OAUTH_CLIENT_ID && process.env.TAILSCALE_OAUTH_CLIENT_SECRET) {
    const now = Date.now();
    if (_tokenCache.token && now < _tokenCache.exp - 60000) {
      return `Bearer ${_tokenCache.token}`;
    }
    const body = new URLSearchParams({
      client_id: process.env.TAILSCALE_OAUTH_CLIENT_ID,
      client_secret: process.env.TAILSCALE_OAUTH_CLIENT_SECRET,
      grant_type: "client_credentials",
    });
    const data = await fetchJson(`${API_BASE}/api/v2/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const token = data?.access_token;
    if (!token) throw new Error("Tailscale OAuth không trả access_token");
    _tokenCache = { token, exp: now + (Number(data.expires_in) || 3600) * 1000 };
    return `Bearer ${token}`;
  }
  // API key tĩnh: HTTP Basic với username = key, password rỗng.
  const basic = Buffer.from(`${process.env.TAILSCALE_API_KEY}:`).toString("base64");
  return `Basic ${basic}`;
}

/**
 * Cấp 1 auth key ephemeral/preauthorized/tagged cho một phiên.
 * @param {object} o
 * @param {string} o.description  mô tả (vd "pickletour-net user <id>")
 * @returns {Promise<{key:string, expiresAt:string|null, tag:string, loginServer:string, keyTtlSeconds:number}>}
 */
export async function createAuthKey({ description = "pickletour-net", extraTags = [] } = {}) {
  if (!isConfigured()) {
    const err = new Error("Chưa cấu hình Tailscale (thiếu OAuth client / API key)");
    err.status = 501;
    throw err;
  }
  const authorization = await getAuthHeader();
  // Gộp tag mặc định + tag phụ (chỉ nhận tag dạng "tag:..."), bỏ trùng.
  const tags = [TAG, ...(Array.isArray(extraTags) ? extraTags : [])]
    .map((t) => String(t || "").trim())
    .filter((t) => /^tag:[a-zA-Z0-9-]+$/.test(t));
  const uniqTags = [...new Set(tags)];
  const payload = {
    description: String(description).slice(0, 120),
    expirySeconds: KEY_TTL,
    capabilities: {
      devices: {
        create: {
          reusable: false,
          ephemeral: true,
          preauthorized: true,
          tags: uniqTags,
        },
      },
    },
  };
  const data = await fetchJson(`${API_BASE}/api/v2/tailnet/${encodeURIComponent(TAILNET)}/keys`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!data?.key) throw new Error("Tailscale không trả auth key");
  return {
    key: data.key, // tskey-auth-... (bí mật — chỉ gửi cho đúng thiết bị của user)
    expiresAt: data.expires || null,
    tag: TAG,
    tags: uniqTags,
    loginServer: process.env.TAILSCALE_LOGIN_SERVER || "",
    keyTtlSeconds: KEY_TTL,
  };
}

// Tag gán thêm cho MÁY LIVE để làm relay (route commentary/điều khiển). Mặc định "tag:relay".
export const RELAY_TAG = process.env.TAILSCALE_RELAY_TAG || "tag:relay";

export default { isConfigured, networkConfig, createAuthKey, RELAY_TAG };
