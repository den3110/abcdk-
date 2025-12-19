// controllers/facebookPageController.js
import axios from "axios";

const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || "v24.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const DEFAULT_FIELDS =
  "id,name,link,category,about,description,fan_count,followers_count,picture{url},cover";

const previewToken = (t = "") => {
  const s = String(t || "");
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
};

const parseTokens = (input) => {
  if (Array.isArray(input)) {
    return input
      .flatMap((x) => String(x || "").split(/[\n,]+/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(input || "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;

  const workers = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i], i);
      }
    });

  await Promise.all(workers);
  return out;
}

// ===== Single (giữ như cũ, optional) =====
export const getPageInfo = async (req, res) => {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) {
      return res.status(400).json({
        ok: false,
        message:
          "Missing PAGE_ACCESS_TOKEN. Send via Authorization: Bearer <token>",
      });
    }

    const pageId = String(req.query.pageId || "").trim();
    const fields = String(req.query.fields || DEFAULT_FIELDS).slice(0, 800);

    const path = pageId ? `/${encodeURIComponent(pageId)}` : "/me";
    const url = `${GRAPH_BASE}${path}`;

    const { data } = await axios.get(url, {
      params: { access_token: token, fields },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (data?.error) {
      return res
        .status(400)
        .json({ ok: false, message: data.error.message, error: data.error });
    }

    return res.json({ ok: true, data });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, message: e?.message || "Server error" });
  }
};

// ===== Bulk (mới) =====
// POST /api/facebook/page-info/bulk
// body: { tokens: "t1,t2\n t3", fields?: "..." } hoặc { tokens: ["t1","t2"] }
export const getPageInfoBulk = async (req, res) => {
  try {
    const fields = String(req.body?.fields || DEFAULT_FIELDS).slice(0, 800);

    const rawTokens =
      req.body?.tokens ?? req.body?.tokenList ?? req.body?.token ?? "";
    let tokens = parseTokens(rawTokens);
    tokens = Array.from(new Set(tokens));

    const MAX = Number(process.env.FB_PAGEINFO_MAX || 50);
    const CONCURRENCY = Number(process.env.FB_PAGEINFO_CONCURRENCY || 4);

    if (!tokens.length)
      return res.status(400).json({ ok: false, message: "No tokens provided" });
    if (tokens.length > MAX) tokens = tokens.slice(0, MAX);

    const results = await mapLimit(tokens, CONCURRENCY, async (token) => {
      const tokenPreview = previewToken(token);

      // 1) thử lấy page info trực tiếp
      try {
        const r1 = await axios.get(`${GRAPH_BASE}/me`, {
          params: { access_token: token, fields },
          timeout: 15000,
          validateStatus: () => true,
        });

        const data1 = r1.data;

        if (!data1?.error) {
          // page token OK
          return { ok: true, kind: "page", tokenPreview, data: data1 };
        }

        const msg = String(data1?.error?.message || "");

        // 2) nếu lỗi kiểu "node type (User)" => token là user token => fallback /me/accounts
        if (msg.includes("node type (User)")) {
          // me basic
          const meRes = await axios.get(`${GRAPH_BASE}/me`, {
            params: { access_token: token, fields: "id,name" },
            timeout: 15000,
            validateStatus: () => true,
          });

          if (meRes.data?.error) {
            return {
              ok: false,
              kind: "user",
              tokenPreview,
              error: meRes.data.error,
            };
          }

          // list pages user quản lý
          const accRes = await axios.get(`${GRAPH_BASE}/me/accounts`, {
            params: {
              access_token: token,
              fields: "id,name,category,picture{url},access_token",
              limit: 200,
            },
            timeout: 15000,
            validateStatus: () => true,
          });

          if (accRes.data?.error) {
            return {
              ok: false,
              kind: "user",
              tokenPreview,
              me: meRes.data,
              error: accRes.data.error,
            };
          }

          return {
            ok: true,
            kind: "user",
            tokenPreview,
            me: meRes.data,
            pages: Array.isArray(accRes.data?.data) ? accRes.data.data : [],
            note: "Token này là USER token → pages lấy từ /me/accounts (có kèm page access_token).",
          };
        }

        // 3) lỗi khác (token invalid / permission / expired…)
        return {
          ok: false,
          kind: "unknown",
          tokenPreview,
          error: {
            message: data1?.error?.message,
            type: data1?.error?.type,
            code: data1?.error?.code,
            subcode: data1?.error?.error_subcode,
            fbtrace_id: data1?.error?.fbtrace_id,
          },
        };
      } catch (e) {
        return {
          ok: false,
          kind: "unknown",
          tokenPreview,
          error: { message: e?.message },
        };
      }
    });

    const okCount = results.filter((r) => r.ok).length;
    return res.json({ ok: true, count: results.length, okCount, results });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, message: e?.message || "Server error" });
  }
};
