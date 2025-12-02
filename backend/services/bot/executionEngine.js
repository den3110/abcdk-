// services/executionEngine.js
// Engine thực thi "skill" đã được học: đọc action DSL và chạy tương ứng

import axios from "axios";
import mongoose from "mongoose";

// import các model của bạn, ví dụ:
import Tournament from "../../models/tournamentModel.js";
// import User from "../models/userModel.js";
// import Match from "../models/matchModel.js";

// Helper lấy model theo tên (whitelist)
const MODEL_MAP = {
  tournaments: Tournament,
  // users: User,
  // matches: Match,
  // ...
};

// Các handler nội bộ (code JS bạn tự định nghĩa, nhưng nằm trong whitelist này)
const INTERNAL_HANDLERS = {
  /**
   * Ví dụ handler nội bộ:
   * - params: object các tham số đã extract từ câu hỏi
   * - context: có thể chứa currentUser, reqId, ...
   */
  async example_internal_handler(params, context) {
    // Ví dụ: return lại param để demo
    return {
      echoParams: params,
      by: context?.currentUser || "system",
    };
  },

  // Thêm các handler khác của bạn tại đây
  // async get_user_profile(params, context) { ... }
};

// Base URL cho các HTTP action (chỉ nên call nội bộ hệ thống của bạn)
const INTERNAL_HTTP_BASE_URL =
  process.env.INTERNAL_HTTP_BASE_URL || "http://localhost:3000";

/**
 * Thực thi một skill đã được lưu (warm path)
 * @param {Object} skill           - skill lấy từ Mongo (Skill document)
 * @param {Object} extractedParams - param đã extract từ câu hỏi user
 * @param {Object} context         - context runtime (currentUser, headers, ...)
 * @returns {Promise<string>}      - chuỗi đã render để trả về cho user
 */
export async function executeSkill(skill, extractedParams = {}, context = {}) {
  if (!skill || !skill.action) {
    throw new Error("Skill hoặc action không hợp lệ");
  }

  const action = skill.action;
  // Cho phép cả response_template và responseTemplate
  const responseTemplate =
    skill.response_template || skill.responseTemplate || "{{result}}";

  switch (action.type) {
    case "mongo":
      return executeMongoAction(action, responseTemplate, extractedParams);

    case "http":
      return executeHttpAction(action, responseTemplate, extractedParams, context);

    case "internal":
      return executeInternalAction(action, responseTemplate, extractedParams, context);

    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}

/* ======================= MONGO ACTION ======================= */

/**
 * Chạy action.type = "mongo"
 * @param {Object} action
 * @param {string} responseTemplate
 * @param {Object} extractedParams
 * @returns {Promise<string>}
 */
async function executeMongoAction(action, responseTemplate, extractedParams) {
  const cfg = action.config || {};
  const collectionName = cfg.collection;

  const Model = MODEL_MAP[collectionName];
  if (!Model) {
    throw new Error(`Unknown collection: ${collectionName}`);
  }

  // build filter từ template (có thể chứa {{param}})
  const filter = buildFilter(cfg.filterTemplate || {}, extractedParams);
  const query = Model.find(filter);

  if (cfg.sort) {
    query.sort(cfg.sort);
  }
  // resolve limit (may come as template string)
  if (cfg.limit !== undefined) {
    const rendered = applyStringTemplate(String(cfg.limit), extractedParams);
    const limitNum = Number(rendered);
    if (Number.isFinite(limitNum) && limitNum > 0) {
      query.limit(limitNum);
    }
  }
  if (cfg.select) {
    query.select(cfg.select);
  }

  const docs = await query.lean();

  // Data sẽ được inject vào template
  const dataForTpl = {
    ...extractedParams,
    count: docs.length,
    list: docs,
    result: docs,
    results: docs
  };

  return renderTemplate(responseTemplate, dataForTpl);
}

/* ======================= HTTP ACTION ======================= */

/**
 * Chạy action.type = "http"
 * Chỉ nên dùng cho các API nội bộ của hệ thống bạn.
 *
 * action.config ví dụ:
 * {
 *   "method": "GET",
 *   "pathTemplate": "/api/tournaments?city={{city}}",
 *   "bodyTemplate": { "limit": "{{limit}}" }
 * }
 *
 * @param {Object} action
 * @param {string} responseTemplate
 * @param {Object} extractedParams
 * @param {Object} context
 * @returns {Promise<string>}
 */
async function executeHttpAction(action, responseTemplate, extractedParams, context) {
  const cfg = action.config || {};
  const method = (cfg.method || "GET").toUpperCase();

  // Path chỉ cho phép relative; không cho phép full URL để tránh SSRF
  let pathTemplate = cfg.pathTemplate || "/";
  if (pathTemplate.startsWith("http://") || pathTemplate.startsWith("https://")) {
    throw new Error("pathTemplate must be relative, not full URL");
  }

  const urlPath = applyStringTemplate(pathTemplate, extractedParams);
  const url = INTERNAL_HTTP_BASE_URL.replace(/\/+$/, "") + urlPath;

  let data = undefined;
  let params = undefined;

  if (["GET", "DELETE"].includes(method)) {
    // body không dùng cho GET/DELETE; nếu cần query string thì embed sẵn vào pathTemplate
  } else {
    const bodyTemplate = cfg.bodyTemplate || {};
    data = buildFilter(bodyTemplate, extractedParams);
  }

  // headers: bạn có thể whitelist một số header từ context nếu cần
  const headers = {
    "Content-Type": "application/json",
  };

  if (context.authToken) {
    headers["Authorization"] = `Bearer ${context.authToken}`;
  }

  const resp = await axios.request({
    url,
    method,
    data,
    params,
    headers,
  });

  const payload = resp.data;

  const dataForTpl = {
    ...extractedParams,
    result: payload,
    // nếu payload là array:
    list: Array.isArray(payload) ? payload : payload?.items || [],
    count: Array.isArray(payload) ? payload.length : payload?.count ?? 0,
  };

  return renderTemplate(responseTemplate, dataForTpl);
}

/* ======================= INTERNAL ACTION ======================= */

/**
 * Chạy action.type = "internal"
 *
 * action.config ví dụ:
 * {
 *   "handlerName": "get_user_profile"
 * }
 *
 * @param {Object} action
 * @param {string} responseTemplate
 * @param {Object} extractedParams
 * @param {Object} context
 * @returns {Promise<string>}
 */
async function executeInternalAction(action, responseTemplate, extractedParams, context) {
  const cfg = action.config || {};
  const handlerName = cfg.handlerName;

  if (!handlerName || !INTERNAL_HANDLERS[handlerName]) {
    throw new Error(`Unknown internal handler: ${handlerName}`);
  }

  const handler = INTERNAL_HANDLERS[handlerName];
  const result = await handler(extractedParams, context);

  const dataForTpl = {
    ...extractedParams,
    result,
    list: Array.isArray(result) ? result : result?.items || [],
    count: Array.isArray(result) ? result.length : result?.count ?? 0,
  };

  return renderTemplate(responseTemplate, dataForTpl);
}

/* ======================= TEMPLATE UTILS ======================= */

/**
 * Thay {{param}} trong object template bằng giá trị từ params.
 * Dùng cho cả filterTemplate, bodyTemplate, v.v.
 */
function buildFilter(template, params) {
  if (!template || typeof template !== "object") return {};

  const result = JSON.parse(JSON.stringify(template));

  const SPECIAL_DATE_TOKENS = new Set(["CURRENT_DATE", "TODAY", "NOW"]);

  function replace(obj) {
    for (const k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const v = obj[k];

      if (typeof v === "string") {
        // {{param}}
        const m = v.match(/^{{(.+)}}$/);
        if (m) {
          const key = m[1].trim();
          obj[k] = params[key];
          continue;
        }
        // Các hằng date phổ biến mà GPT hay sinh ra
        if (SPECIAL_DATE_TOKENS.has(v)) {
          obj[k] = new Date();
          continue;
        }
      } else if (typeof v === "object" && v !== null) {
        replace(v);
      }
    }
  }

  replace(result);
  return result;
}

/**
 * Thay {{param}} trong 1 string đơn giản (dùng cho pathTemplate)
 */
function applyStringTemplate(tpl, params) {
  if (!tpl || typeof tpl !== "string") return tpl;
  return tpl.replace(/{{(.*?)}}/g, (_, key) => {
    const k = key.trim();
    return params[k] != null ? String(params[k]) : "";
  });
}

/**
 * Template renderer rất đơn giản:
 * - Thay {{key}} = data[key]
 * - Hỗ trợ {{#each list}} ... {{/each}} với {{this.field}}
 */
function renderTemplate(tpl, data) {
  if (!tpl || typeof tpl !== "string") return "";

  let out = tpl;

  // {{#each list}}...{{/each}}
  const eachRegex = /{{#each\s+(\w+)}}([\s\S]*?){{\/each}}/g;
  out = out.replace(eachRegex, (_, listName, inner) => {
    const arr = data[listName];
    if (!Array.isArray(arr)) return "";
    return arr
      .map((item) =>
        inner.replace(/{{this\.(\w+)}}/g, (_, field) =>
          item[field] != null ? String(item[field]) : ""
        )
      )
      .join("");
  });

  // {{key}}
  out = out.replace(/{{(.*?)}}/g, (_, key) => {
    const k = key.trim();
    // tránh đụng lại mấy placeholder this.field đã được xử lý ở trên
    if (k.startsWith("this.")) return _;

    const val = data[k];
    if (val == null) return "";

    if (typeof val === "object") {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return String(val);
      }
    }

    return String(val);
  });

  return out;
}