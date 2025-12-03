// services/bot/executionEngine.js
// Engine thực thi "skill" đã được học: đọc action DSL và chạy tương ứng

import axios from "axios";
import mongoose from "mongoose";

// import các model của bạn
import Tournament from "../../models/tournamentModel.js";
import User from "../../models/userModel.js";
import Registration from "../../models/registrationModel.js";
import Match from "../../models/matchModel.js";
import Bracket from "../../models/bracketModel.js";
import Assessment from "../../models/assessmentModel.js";
import ScoreHistory from "../../models/scoreHistoryModel.js";
import RatingChange from "../../models/ratingChangeModel.js";
import Court from "../../models/courtModel.js";
import ReputationEvent from "../../models/reputationEventModel.js";
import { sanitizeUserData } from "./dataSanitizer.js";

// Helper lấy model theo tên (whitelist)
const MODEL_MAP = {
  tournaments: Tournament,
  users: User,
  registrations: Registration,
  matches: Match,
  brackets: Bracket,
  assessments: Assessment,
  scoreHistories: ScoreHistory,
  ratingChanges: RatingChange,
  courts: Court,
  reputationEvents: ReputationEvent,
};

// Các handler nội bộ
const INTERNAL_HANDLERS = {
  async get_current_user_info(params, context) {
    if (!context?.currentUser?._id) {
      return { error: "Bạn cần đăng nhập để xem thông tin này" };
    }

    const user = await User.findById(context.currentUser._id)
      .select(
        "name nickname phone email dob gender province verified cccdStatus role localRatings"
      )
      .lean();

    if (!user) {
      return { error: "Không tìm thấy thông tin người dùng" };
    }

    const userData = {
      name: user.name,
      nickname: user.nickname,
      phone: user.phone,
      email: user.email,
      province: user.province,
      kycStatus: user.cccdStatus,
      verified: user.verified,
      role: user.role,
      ratings: {
        singles: user.localRatings?.singles || 2.5,
        doubles: user.localRatings?.doubles || 2.5,
        matchesSingles: user.localRatings?.matchesSingles || 0,
        matchesDoubles: user.localRatings?.matchesDoubles || 0,
        reliabilitySingles: user.localRatings?.reliabilitySingles || 0,
        reliabilityDoubles: user.localRatings?.reliabilityDoubles || 0,
      },
    };

    return userData;
  },

  async search_users_public(params, context) {
    const { name, nickname, province, limit = 10 } = params;

    const filter = { isDeleted: false };

    if (name) {
      filter.name = { $regex: name, $options: "i" };
    }
    if (nickname) {
      filter.nickname = { $regex: nickname, $options: "i" };
    }
    if (province) {
      filter.province = province;
    }

    const users = await User.find(filter)
      .select("name nickname gender dob province localRatings")
      .limit(Number(limit))
      .lean();

    const items = users.map((u) => ({
      name: u.name,
      nickname: u.nickname,
      gender: u.gender,
      age: u.dob ? calculateAge(u.dob) : null,
      province: u.province,
      ratings: {
        singles: u.localRatings?.singles || 2.5,
        doubles: u.localRatings?.doubles || 2.5,
      },
    }));

    return {
      items,
      count: items.length,
    };
  },

  async count_user_tournaments(params, context) {
    if (!context?.currentUser?._id) {
      return { count: 0, error: "Cần đăng nhập" };
    }

    const count = await Registration.countDocuments({
      $or: [
        { "player1.user": context.currentUser._id },
        { "player2.user": context.currentUser._id },
      ],
    });

    return { count };
  },

  async get_user_registrations(params, context) {
    if (!context?.currentUser?._id) {
      return { items: [], error: "Cần đăng nhập" };
    }

    const limit = params.limit || 10;

    const regs = await Registration.find({
      $or: [
        { "player1.user": context.currentUser._id },
        { "player2.user": context.currentUser._id },
      ],
    })
      .populate("tournament", "name code status startDate location")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return {
      items: regs.map((r) => ({
        code: r.code,
        tournament: r.tournament,
        paymentStatus: r.payment?.status,
        checkedIn: !!r.checkinAt,
        createdAt: r.createdAt,
      })),
      count: regs.length,
    };
  },

  async get_user_assessments(params, context) {
    if (!context?.currentUser?._id) {
      return { items: [], error: "Cần đăng nhập" };
    }

    const limit = params.limit || 5;

    const assessments = await Assessment.find({
      user: context.currentUser._id,
    })
      .populate("scorer", "name nickname")
      .sort({ scoredAt: -1 })
      .limit(limit)
      .lean();

    return {
      items: assessments.map((a) => ({
        singleLevel: a.singleLevel,
        doubleLevel: a.doubleLevel,
        scoredBy: a.scorer?.name || a.scorer?.nickname || "System",
        scoredAt: a.scoredAt,
        note: a.note,
      })),
      count: assessments.length,
    };
  },

  async get_user_rating_changes(params, context) {
    if (!context?.currentUser?._id) {
      return { items: [], error: "Cần đăng nhập" };
    }

    const limit = params.limit || 10;
    const kind = params.kind || "doubles";

    const changes = await RatingChange.find({
      user: context.currentUser._id,
      kind,
    })
      .populate("tournament", "name code")
      .populate("match", "roundKey")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return {
      items: changes.map((c) => ({
        tournament: c.tournament?.name,
        before: c.before,
        after: c.after,
        delta: c.delta,
        result: c.score === 1 ? "Thắng" : "Thua",
        date: c.createdAt,
      })),
      count: changes.length,
    };
  },

  async example_internal_handler(params, context) {
    return {
      echoParams: params,
      by: context?.currentUser || "system",
    };
  },
};

const INTERNAL_HTTP_BASE_URL =
  process.env.INTERNAL_HTTP_BASE_URL || "http://localhost:3000";

/**
 * Thực thi một skill đã được lưu
 */
export async function executeSkill(skill, extractedParams = {}, context = {}) {
  if (!skill || !skill.action) {
    throw new Error("Skill hoặc action không hợp lệ");
  }

  const action = skill.action;
  const responseTemplate =
    skill.response_template || skill.responseTemplate || "{{result}}";

  switch (action.type) {
    case "mongo":
      return executeMongoAction(
        action,
        responseTemplate,
        extractedParams,
        context
      );

    case "aggregate":
      return executeAggregateAction(
        action,
        responseTemplate,
        extractedParams,
        context
      );

    case "http":
      return executeHttpAction(
        action,
        responseTemplate,
        extractedParams,
        context
      );

    case "internal":
      return executeInternalAction(
        action,
        responseTemplate,
        extractedParams,
        context
      );

    default:
      throw new Error(`Unsupported action type: ${action.type}`);
  }
}

/* ======================= MONGO ACTION ======================= */

async function executeMongoAction(
  action,
  responseTemplate,
  extractedParams,
  context = {}
) {
  const cfg = action.config || {};
  const collectionName = cfg.collection;

  console.log("[executeMongoAction] Collection:", collectionName);

  const Model = MODEL_MAP[collectionName];
  if (!Model) {
    throw new Error(`Unknown collection: ${collectionName}`);
  }

  const filter = buildFilter(
    cfg.filterTemplate || {},
    extractedParams,
    context
  );

  console.log("[executeMongoAction] Built Filter:", JSON.stringify(filter));

  let query = Model.find(filter);

  if (cfg.sort) query.sort(cfg.sort);

  if (cfg.limit !== undefined) {
    const rendered = applyStringTemplate(String(cfg.limit), extractedParams);
    const limitNum = Number(rendered);
    if (Number.isFinite(limitNum) && limitNum > 0) {
      query.limit(limitNum);
    }
  }

  // ✅ SECURITY: Override select for users collection
  if (collectionName === "users") {
    const isQueryingOwnData =
      filter._id &&
      context.currentUserId &&
      String(filter._id) === String(context.currentUserId);

    if (!isQueryingOwnData) {
      console.log("[SECURITY] Querying other users - applying safe select");
      cfg.select = "name nickname gender dob province localRatings";
    }
  }

  if (cfg.select) query.select(cfg.select);

  if (cfg.populate && Array.isArray(cfg.populate)) {
    cfg.populate.forEach((pop) => {
      if (typeof pop === "string") {
        query.populate(pop);
      } else if (pop.path) {
        query.populate(pop);
      }
    });
  }

  let docs = await query.lean();

  console.log("[executeMongoAction] Found docs:", docs?.length);

  // ✅ SECURITY: Sanitize user data
  if (collectionName === "users") {
    const isOwnData =
      docs.length === 1 &&
      context.currentUserId &&
      String(docs[0]._id) === String(context.currentUserId);

    docs = docs.map((doc) => sanitizeUserData(doc, isOwnData));
    console.log("[SECURITY] User data sanitized");
  }

  // Calculate ages for users
  if (collectionName === "users" && docs.length > 0) {
    docs = docs.map((doc) => {
      if (doc.dob && !doc.age) {
        doc.age = calculateAge(doc.dob);
      }
      return doc;
    });
  }

  const dataForTpl = {
    ...extractedParams,
    count: docs.length,
    list: docs,
    result: docs,
    results: docs,
    first: docs[0] || null,
  };

  const rendered = renderTemplate(responseTemplate, dataForTpl);

  console.log("[executeMongoAction] Rendered result:", rendered);

  return rendered;
}

/* ======================= AGGREGATE ACTION ======================= */

async function executeAggregateAction(
  action,
  responseTemplate,
  extractedParams,
  context = {}
) {
  const cfg = action.config || {};
  const collectionName = cfg.collection;
  const pipeline = cfg.pipeline;

  console.log("[executeAggregateAction] Collection:", collectionName);

  if (!collectionName || !Array.isArray(pipeline)) {
    throw new Error("aggregate action requires collection and pipeline array");
  }

  const Model = MODEL_MAP[collectionName];
  if (!Model) {
    throw new Error(`Unknown collection: ${collectionName}`);
  }

  // Replace {{params}} in pipeline
  const builtPipeline = buildPipeline(pipeline, extractedParams, context);

  console.log(
    "[executeAggregateAction] Pipeline:",
    JSON.stringify(builtPipeline, null, 2)
  );

  const results = await Model.aggregate(builtPipeline);

  console.log("[executeAggregateAction] Results count:", results?.length);

  const dataForTpl = {
    ...extractedParams,
    count: results.length,
    list: results,
    result: results,
    results: results,
    first: results[0] || null,
  };

  const rendered = renderTemplate(responseTemplate, dataForTpl);

  console.log("[executeAggregateAction] Rendered result:", rendered);

  return rendered;
}

function buildPipeline(pipeline, params, context = {}) {
  const SPECIAL_DATE_TOKENS = new Set(["CURRENT_DATE", "TODAY", "NOW"]);

  // Deep clone
  const cloned = JSON.parse(JSON.stringify(pipeline));

  function replace(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(replace);
      return;
    }

    if (obj && typeof obj === "object") {
      for (const k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        const v = obj[k];

        if (typeof v === "string") {
          // Handle {{variable}}
          const m = v.match(/^{{(.+)}}$/);
          if (m) {
            const key = m[1].trim();

            let value = undefined;

            // Priority: params > context
            if (params[key] !== undefined) {
              value = params[key];
            } else if (context[key] !== undefined) {
              value = context[key];
            } else if (key === "currentUserId" && context.currentUser?._id) {
              value = context.currentUser._id;
            } else if (key === "tournamentId" && context.tournamentId) {
              value = context.tournamentId;
            } else if (key === "matchId" && context.matchId) {
              value = context.matchId;
            } else if (key === "bracketId" && context.bracketId) {
              value = context.bracketId;
            } else if (key === "courtCode" && context.courtCode) {
              value = context.courtCode;
            }

            // Convert to ObjectId if needed (except courtCode)
            if (
              value &&
              key !== "courtCode" &&
              (k === "_id" ||
                k === "user" ||
                k === "tournament" ||
                k === "match" ||
                k === "bracket" ||
                k === "court")
            ) {
              if (
                typeof value === "string" &&
                mongoose.Types.ObjectId.isValid(value)
              ) {
                value = new mongoose.Types.ObjectId(value);
              }
            }

            obj[k] = value;
            continue;
          }

          // Handle special date tokens
          if (SPECIAL_DATE_TOKENS.has(v)) {
            obj[k] = new Date();
            continue;
          }
        } else if (typeof v === "object" && v !== null) {
          replace(v);
        }
      }
    }
  }

  replace(cloned);
  return cloned;
}

/* ======================= HTTP ACTION ======================= */

async function executeHttpAction(
  action,
  responseTemplate,
  extractedParams,
  context
) {
  const cfg = action.config || {};
  const method = (cfg.method || "GET").toUpperCase();

  let pathTemplate = cfg.pathTemplate || "/";
  if (
    pathTemplate.startsWith("http://") ||
    pathTemplate.startsWith("https://")
  ) {
    throw new Error("pathTemplate must be relative, not full URL");
  }

  const urlPath = applyStringTemplate(pathTemplate, extractedParams);
  const url = INTERNAL_HTTP_BASE_URL.replace(/\/+$/, "") + urlPath;

  let data = undefined;
  let params = undefined;

  if (["GET", "DELETE"].includes(method)) {
    // No body for GET/DELETE
  } else {
    const bodyTemplate = cfg.bodyTemplate || {};
    data = buildFilter(bodyTemplate, extractedParams);
  }

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
    list: Array.isArray(payload) ? payload : payload?.items || [],
    count: Array.isArray(payload) ? payload.length : payload?.count ?? 0,
  };

  return renderTemplate(responseTemplate, dataForTpl);
}

/* ======================= INTERNAL ACTION ======================= */

async function executeInternalAction(
  action,
  responseTemplate,
  extractedParams,
  context
) {
  const cfg = action.config || {};
  const handlerName = cfg.handlerName;

  console.log("[executeInternalAction] Handler:", handlerName);
  console.log("[executeInternalAction] Context:", {
    currentUserId: context.currentUserId,
  });

  if (!handlerName || !INTERNAL_HANDLERS[handlerName]) {
    throw new Error(`Unknown internal handler: ${handlerName}`);
  }

  const handler = INTERNAL_HANDLERS[handlerName];
  const result = await handler(extractedParams, context);

  console.log("[executeInternalAction] Handler result:", result);

  const dataForTpl = {
    ...extractedParams,
    result,
    first: result,
    list: Array.isArray(result) ? result : result?.items || [],
    count: Array.isArray(result) ? result.length : result?.count ?? 0,
  };

  console.log("[executeInternalAction] Data for template:", {
    hasFirst: !!dataForTpl.first,
    hasResult: !!dataForTpl.result,
  });

  const rendered = renderTemplate(responseTemplate, dataForTpl);

  console.log("[executeInternalAction] Rendered:", rendered);

  return rendered;
}

/* ======================= TEMPLATE UTILS ======================= */

function buildFilter(template, params, context = {}) {
  if (!template || typeof template !== "object") return {};

  const result = JSON.parse(JSON.stringify(template));
  const SPECIAL_DATE_TOKENS = new Set(["CURRENT_DATE", "TODAY", "NOW"]);

  function replace(obj) {
    for (const k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      const v = obj[k];

      if (typeof v === "string") {
        const m = v.match(/^{{(.+)}}$/);
        if (m) {
          const key = m[1].trim();

          let value = undefined;

          if (params[key] !== undefined) {
            value = params[key];
          } else if (context[key] !== undefined) {
            value = context[key];
          } else if (key === "currentUserId" && context.currentUser?._id) {
            value = context.currentUser._id;
          } else if (key === "tournamentId" && context.tournamentId) {
            value = context.tournamentId;
          } else if (key === "matchId" && context.matchId) {
            value = context.matchId;
          } else if (key === "bracketId" && context.bracketId) {
            value = context.bracketId;
          } else if (key === "courtCode" && context.courtCode) {
            value = context.courtCode;
          }

          if (
            value &&
            key !== "courtCode" &&
            (k === "_id" ||
              k.endsWith("._id") ||
              k === "user" ||
              k === "tournament" ||
              k === "match" ||
              k === "bracket" ||
              k === "court")
          ) {
            if (
              typeof value === "string" &&
              mongoose.Types.ObjectId.isValid(value)
            ) {
              value = new mongoose.Types.ObjectId(value);
            }
          }

          obj[k] = value;
          continue;
        }

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

function applyStringTemplate(tpl, params) {
  if (!tpl || typeof tpl !== "string") return tpl;
  return tpl.replace(/{{(.*?)}}/g, (_, key) => {
    const k = key.trim();
    return params[k] != null ? String(params[k]) : "";
  });
}

/**
 * ✅ ENHANCED: Support nested fields like {{first.localRatings.doubles}}
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
      .map((item) => {
        let itemOut = inner;
        // Support {{this.nested.field}}
        itemOut = itemOut.replace(/{{this\.([\w.]+)}}/g, (__, path) => {
          const val = getNestedValue(item, path);
          return val != null ? String(val) : "";
        });
        return itemOut;
      })
      .join("");
  });

  // ✅ Support {{first.nested.field}}
  out = out.replace(/{{first\.([\w.]+)}}/g, (_, path) => {
    const firstItem = data.first;
    if (!firstItem) return "";
    const val = getNestedValue(firstItem, path);
    return val != null ? String(val) : "";
  });

  // ✅ Support {{list.0.nested.field}}
  out = out.replace(/{{list\.(\d+)\.([\w.]+)}}/g, (_, index, path) => {
    const arr = data.list;
    if (!Array.isArray(arr)) return "";
    const item = arr[parseInt(index)];
    if (!item) return "";
    const val = getNestedValue(item, path);
    return val != null ? String(val) : "";
  });

  // {{key}} for simple fields
  out = out.replace(/{{(.*?)}}/g, (_, key) => {
    const k = key.trim();
    if (
      k.startsWith("this.") ||
      k.startsWith("first.") ||
      k.match(/^list\.\d+\./)
    ) {
      return _; // already handled
    }

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

/**
 * ✅ Helper: Get nested value like "localRatings.doubles"
 */
function getNestedValue(obj, path) {
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current == null) return null;
    current = current[key];
  }
  return current;
}

function calculateAge(dob) {
  if (!dob) return null;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
}
