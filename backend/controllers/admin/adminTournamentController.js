// controllers/tournamentController.js
import mongoose from "mongoose";
import Joi from "joi";
import sanitizeHtml from "sanitize-html";
import { DateTime } from "luxon";
import expressAsyncHandler from "express-async-handler";

import Tournament from "../../models/tournamentModel.js";
import Registration from "../../models/registrationModel.js";
import { addTournamentReputationBonus } from "../../services/reputationService.js";
import { autoPlan } from "../../services/tournamentPlanner.js";
import {
  buildGroupBracket,
  buildKnockoutBracket,
  buildRoundElimBracket,
} from "../../services/bracketBuilder.js";
import { scheduleTournamentCountdown } from "../../utils/scheduleNotifications.js";
import Bracket from "../../models/bracketModel.js";
import { createForumTopic, createInviteLink } from "../../utils/telegram.js";
import Match from "../../models/matchModel.js";
import dotenv from "dotenv";
import User from "../../models/userModel.js";
import { canManageTournament } from "../../utils/tournamentAuth.js";

dotenv.config();

/* -------------------------- Sanitize cấu hình -------------------------- */
const SAFE_HTML = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    "h1",
    "h2",
    "h3",
    "img",
    "span",
    "blockquote",
    "code",
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    "*": ["class", "style"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
    }),
  },
};
const cleanHTML = (html = "") => sanitizeHtml(html, SAFE_HTML);

/* --------------------------- Field labels (VN) --------------------------- */
const FIELD_LABELS = {
  name: "Tên giải đấu",
  image: "Ảnh",
  code: "Mã giải",
  sportType: "Loại môn",
  groupId: "Nhóm",
  eventType: "Hình thức",
  regOpenDate: "Mở đăng ký",
  registrationDeadline: "Hạn đăng ký",
  startDate: "Ngày bắt đầu",
  endDate: "Ngày kết thúc",
  scoreCap: "Điểm trần (cap)",
  scoreGap: "Chênh lệch điểm tối thiểu",
  singleCap: "Cap đơn",
  maxPairs: "Số cặp tối đa",
  location: "Địa điểm",
  contactHtml: "Thông tin liên hệ",
  contentHtml: "Nội dung",

  scoringScope: "Phạm vi chấm",
  "scoringScope.type": "Loại phạm vi chấm",
  "scoringScope.provinces": "Các tỉnh áp dụng",

  bankShortName: "Tên ngân hàng",
  bankAccountNumber: "Số tài khoản",
  bankAccountName: "Tên chủ tài khoản",
  registrationFee: "Phí đăng ký (VND)",

  requireKyc: "Yêu cầu KYC",
  ageRestriction: "Giới hạn tuổi",
  "ageRestriction.enabled": "Bật giới hạn tuổi",
  "ageRestriction.minAge": "Tuổi tối thiểu",
  "ageRestriction.maxAge": "Tuổi tối đa",
};

function labelOf(pathArr = []) {
  const joined = pathArr.join(".");
  const last = pathArr[pathArr.length - 1];
  return (
    FIELD_LABELS[joined] || FIELD_LABELS[last] || joined || "Trường dữ liệu"
  );
}

/* ------------------------- Joi common messages (VN) ------------------------- */
const COMMON_MESSAGES = {
  "any.required": "{{#label}} là bắt buộc",
  "any.only": "{{#label}} không hợp lệ",
  "any.invalid": "{{#label}} không hợp lệ",
  "string.base": "{{#label}} phải là chuỗi",
  "string.min": "{{#label}} phải ≥ {{#limit}} ký tự",
  "string.max": "{{#label}} không được vượt quá {{#limit}} ký tự",
  "string.uri": "{{#label}} phải là URL hợp lệ",
  "string.pattern.base": "{{#label}} không hợp lệ",
  "number.base": "{{#label}} phải là số",
  "number.min": "{{#label}} phải ≥ {{#limit}}",
  "number.max": "{{#label}} phải ≤ {{#limit}}",
  "number.integer": "{{#label}} phải là số nguyên",
  "date.base": "{{#label}} phải là ngày hợp lệ (ISO)",
  "date.iso": "{{#label}} phải theo định dạng ISO",
  "date.min": "{{#label}} phải ≥ {{#limit.key}}",
};

/* ------------------------------ Joi schemas --------------------------- */
const dateISO = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  .custom((value, helpers) => {
    const dt = DateTime.fromISO(value, { zone: "Asia/Ho_Chi_Minh" });
    if (!dt.isValid) {
      return helpers.error("date.invalid");
    }
    return value;
  })
  .messages({
    "string.pattern.base": "{{#label}} phải theo định dạng YYYY-MM-DDTHH:mm:ss",
    "date.invalid": "{{#label}} không hợp lệ",
  });

const boolLoose = Joi.boolean()
  .truthy(1, "1", "true", "yes", "y", "on")
  .falsy(0, "0", "false", "no", "n", "off");

/* ----- scoringScope (đa tỉnh) ----- */
const scoringScopeCreate = Joi.object({
  type: Joi.string()
    .valid("national", "provinces")
    .required()
    .label(FIELD_LABELS["scoringScope.type"]),
  provinces: Joi.array()
    .items(Joi.string().trim().min(1))
    .when("type", {
      is: "provinces",
      then: Joi.array()
        .min(1)
        .required()
        .label(FIELD_LABELS["scoringScope.provinces"]),
      otherwise: Joi.forbidden(),
    }),
})
  .label(FIELD_LABELS.scoringScope)
  .default({ type: "national" });

const scoringScopeUpdate = Joi.object({
  type: Joi.string()
    .valid("national", "provinces")
    .label(FIELD_LABELS["scoringScope.type"]),
  provinces: Joi.array()
    .items(Joi.string().trim().min(1))
    .when("type", {
      is: "provinces",
      then: Joi.array()
        .min(1)
        .required()
        .label(FIELD_LABELS["scoringScope.provinces"]),
      otherwise: Joi.forbidden(),
    }),
}).label(FIELD_LABELS.scoringScope);

/* ----- thanh toán (SePay) ----- */
const bankShortName = Joi.string()
  .trim()
  .max(64)
  .allow("")
  .empty("")
  .label(FIELD_LABELS.bankShortName);
const bankAccountNumber = Joi.string()
  .pattern(/^\d{4,32}$/)
  .messages({ "string.pattern.base": "{{#label}} phải gồm 4–32 chữ số (0–9)" })
  .allow("")
  .empty("")
  .label(FIELD_LABELS.bankAccountNumber);
const bankAccountName = Joi.string()
  .trim()
  .max(64)
  .allow("")
  .empty("")
  .label(FIELD_LABELS.bankAccountName);
const registrationFee = Joi.number()
  .min(0)
  .precision(0)
  .label(FIELD_LABELS.registrationFee);

/* ----- ageRestriction (giới hạn tuổi) + requireKyc ----- */
const ageRestrictionCreate = Joi.object({
  enabled: boolLoose
    .default(false)
    .label(FIELD_LABELS["ageRestriction.enabled"]),
  minAge: Joi.number()
    .integer()
    .min(0)
    .max(100)
    .default(0)
    .label(FIELD_LABELS["ageRestriction.minAge"]),
  maxAge: Joi.number()
    .integer()
    .min(0)
    .max(100)
    .default(100)
    .label(FIELD_LABELS["ageRestriction.maxAge"]),
})
  .label(FIELD_LABELS.ageRestriction)
  .custom((ar, helpers) => {
    if (ar.enabled && ar.minAge > ar.maxAge) {
      return helpers.message(
        `"${FIELD_LABELS["ageRestriction.minAge"]}" phải ≤ "${FIELD_LABELS["ageRestriction.maxAge"]}"`
      );
    }
    return ar;
  });

const ageRestrictionUpdate = Joi.object({
  enabled: boolLoose.label(FIELD_LABELS["ageRestriction.enabled"]),
  minAge: Joi.number()
    .integer()
    .min(0)
    .max(100)
    .label(FIELD_LABELS["ageRestriction.minAge"]),
  maxAge: Joi.number()
    .integer()
    .min(0)
    .max(100)
    .label(FIELD_LABELS["ageRestriction.maxAge"]),
})
  .label(FIELD_LABELS.ageRestriction)
  .custom((ar, helpers) => {
    if (
      (ar.enabled === true || ar.enabled === "true" || ar.enabled === 1) &&
      Number.isFinite(ar.minAge) &&
      Number.isFinite(ar.maxAge) &&
      ar.minAge > ar.maxAge
    ) {
      return helpers.message(
        `"${FIELD_LABELS["ageRestriction.minAge"]}" phải ≤ "${FIELD_LABELS["ageRestriction.maxAge"]}"`
      );
    }
    return ar;
  });

/* --------------------------------- CREATE --------------------------------- */
const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required().label(FIELD_LABELS.name),
  code: Joi.string().trim().min(3).max(32).label(FIELD_LABELS.code),

  image: Joi.string().uri().allow("").label(FIELD_LABELS.image),
  sportType: Joi.number().valid(1, 2).required().label(FIELD_LABELS.sportType),
  groupId: Joi.number().integer().min(0).default(0).label(FIELD_LABELS.groupId),
  eventType: Joi.string()
    .valid("single", "double")
    .default("double")
    .label(FIELD_LABELS.eventType),

  regOpenDate: dateISO.required().label(FIELD_LABELS.regOpenDate),
  registrationDeadline: dateISO
    .required()
    .label(FIELD_LABELS.registrationDeadline),
  startDate: dateISO.required().label(FIELD_LABELS.startDate),
  endDate: dateISO.required().label(FIELD_LABELS.endDate),

  scoreCap: Joi.number().min(0).default(0).label(FIELD_LABELS.scoreCap),
  scoreGap: Joi.number().min(0).default(0).label(FIELD_LABELS.scoreGap),
  singleCap: Joi.number().min(0).default(0).label(FIELD_LABELS.singleCap),
  maxPairs: Joi.number()
    .integer()
    .min(0)
    .default(0)
    .label(FIELD_LABELS.maxPairs),

  location: Joi.string().trim().min(2).required().label(FIELD_LABELS.location),
  contactHtml: Joi.string()
    .allow("")
    .max(20_000)
    .default("")
    .label(FIELD_LABELS.contactHtml),
  contentHtml: Joi.string()
    .allow("")
    .max(100_000)
    .default("")
    .label(FIELD_LABELS.contentHtml),

  noRankDelta: boolLoose.default(false).label("Không áp dụng điểm trình"),
  requireKyc: boolLoose.default(true).label(FIELD_LABELS.requireKyc),

  scoringScope: scoringScopeCreate,
  bankShortName: bankShortName.default(""),
  bankAccountNumber: bankAccountNumber.default(""),
  bankAccountName: bankAccountName.default(""),
  registrationFee: registrationFee.default(0),

  ageRestriction: ageRestrictionCreate,
})
  .with("bankShortName", ["bankAccountNumber", "bankAccountName"])
  .with("bankAccountNumber", ["bankShortName", "bankAccountName"])
  .with("bankAccountName", ["bankShortName", "bankAccountNumber"])
  .messages(COMMON_MESSAGES)
  .custom((obj, helpers) => {
    if (obj.endDate < obj.startDate) {
      return helpers.message(
        `"${FIELD_LABELS.endDate}" phải ≥ "${FIELD_LABELS.startDate}"`
      );
    }
    if (obj.registrationDeadline < obj.regOpenDate) {
      return helpers.message(
        `"${FIELD_LABELS.registrationDeadline}" không được trước "${FIELD_LABELS.regOpenDate}"`
      );
    }
    return obj;
  });

/* --------------------------------- UPDATE --------------------------------- */
const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).label(FIELD_LABELS.name),
  code: Joi.string().trim().min(3).max(32).label(FIELD_LABELS.code),
  image: Joi.string().uri().allow("").label(FIELD_LABELS.image),
  sportType: Joi.number().valid(1, 2).label(FIELD_LABELS.sportType),
  groupId: Joi.number().integer().min(0).label(FIELD_LABELS.groupId),
  eventType: Joi.string()
    .valid("single", "double")
    .label(FIELD_LABELS.eventType),

  regOpenDate: dateISO.label(FIELD_LABELS.regOpenDate),
  registrationDeadline: dateISO.label(FIELD_LABELS.registrationDeadline),
  startDate: dateISO.label(FIELD_LABELS.startDate),
  endDate: dateISO.label(FIELD_LABELS.endDate),

  scoreCap: Joi.number().min(0).label(FIELD_LABELS.scoreCap),
  scoreGap: Joi.number().min(0).label(FIELD_LABELS.scoreGap),
  singleCap: Joi.number().min(0).label(FIELD_LABELS.singleCap),
  maxPairs: Joi.number().integer().min(0).label(FIELD_LABELS.maxPairs),

  location: Joi.string().trim().min(2).label(FIELD_LABELS.location),
  contactHtml: Joi.string().allow("").label(FIELD_LABELS.contactHtml),
  contentHtml: Joi.string().allow("").label(FIELD_LABELS.contentHtml),

  noRankDelta: boolLoose.label("Không áp dụng điểm trình"),
  requireKyc: boolLoose.label(FIELD_LABELS.requireKyc),

  scoringScope: scoringScopeUpdate,

  bankShortName,
  bankAccountNumber,
  bankAccountName,
  registrationFee,

  ageRestriction: ageRestrictionUpdate,
})
  .with("bankShortName", ["bankAccountNumber", "bankAccountName"])
  .with("bankAccountNumber", ["bankShortName", "bankAccountName"])
  .with("bankAccountName", ["bankShortName", "bankAccountNumber"])
  .messages(COMMON_MESSAGES)
  .custom((obj, helpers) => {
    if (obj.startDate && obj.endDate) {
      if (obj.endDate < obj.startDate) {
        return helpers.message(
          `"${FIELD_LABELS.endDate}" phải ≥ "${FIELD_LABELS.startDate}"`
        );
      }
    }
    if (obj.regOpenDate && obj.registrationDeadline) {
      if (obj.registrationDeadline < obj.regOpenDate) {
        return helpers.message(
          `"${FIELD_LABELS.registrationDeadline}" không được trước "${FIELD_LABELS.regOpenDate}"`
        );
      }
    }
    return obj;
  });

/* ------------------------------- Helpers ------------------------------ */
const validate = (schema, payload) => {
  const options = {
    convert: false,
    stripUnknown: { objects: true },
    abortEarly: false,
    errors: { wrap: { label: "" } },
  };

  const src = payload || {};
  const normalizedPayload = { ...src };

  // 🔹 Các field datetime cần xử lý
  const dateFields = [
    "regOpenDate",
    "registrationDeadline",
    "startDate",
    "endDate",
  ];

  // 🔹 Trước khi validate: nếu là Date thì đổi về string "YYYY-MM-DDTHH:mm:ss"
  for (const field of dateFields) {
    const v = normalizedPayload[field];
    if (v instanceof Date) {
      // coi như UTC rồi format về chuẩn schema yêu cầu
      const dt = DateTime.fromJSDate(v, { zone: "UTC" });
      normalizedPayload[field] = dt.toFormat("yyyy-LL-dd'T'HH:mm:ss");
    }
  }

  const { error, value } = schema.validate(normalizedPayload, options);
  const strippedKeys = Object.keys(src || {}).filter(
    (k) => !(k in (value || {}))
  );

  if (error) {
    const details = error.details.map((d) => {
      const path = d.path || [];
      const fieldLabel = labelOf(path);
      const rawLabel = d.context?.label ?? path.join(".");
      const message = String(d.message || "")
        .replace(rawLabel, fieldLabel)
        .replace("is not allowed to be empty", "không được để trống")
        .replace("must be a valid date", "phải là ngày hợp lệ (ISO)")
        .replace("must be a number", "phải là số")
        .replace("is required", "là bắt buộc")
        .replace("must be greater than or equal to", "phải ≥")
        .replace("must be less than or equal to", "phải ≤");

      return {
        path: path.join("."),
        field: fieldLabel,
        type: d.type,
        message,
        context: { ...d.context, label: fieldLabel },
      };
    });

    const fields = details.reduce((acc, e) => {
      acc[e.path] = acc[e.path] || [];
      acc[e.path].push(e.message);
      return acc;
    }, {});
    const summary = Array.from(new Set(details.map((d) => d.message))).join(
      "; "
    );

    const err = new Error(
      summary || "Yêu cầu không hợp lệ – dữ liệu không đạt kiểm tra"
    );
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    err.errors = details;
    err.fields = fields;
    err.strippedKeys = strippedKeys;
    throw err;
  }

  // 🔹 Sau khi validate ok: convert string → Date UTC để lưu DB
  for (const field of dateFields) {
    if (value[field] && typeof value[field] === "string") {
      const dateStr = value[field];
      value[field] = new Date(dateStr + "Z"); // thêm 'Z' để parse như UTC

      console.log(`[DEBUG] ${field}:`, {
        input: dateStr,
        dbValue: value[field].toISOString(),
      });
    }
  }

  if (strippedKeys.length) value._meta = { strippedKeys };
  return value;
};

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const parseSort = (s) =>
  String(s || "")
    .split(",")
    .reduce((acc, token) => {
      const key = token.trim();
      if (!key) return acc;
      if (key.startsWith("-")) acc[key.slice(1)] = -1;
      else acc[key] = 1;
      return acc;
    }, {});
const isValidTZ = (tz) => {
  if (!tz) return false;
  const dt = DateTime.now().setZone(tz);
  return dt.isValid;
};

/* -------------------------------------------------------------------------- */
/*  Controllers  - GIỮ NGUYÊN TẤT CẢ                                         */
/* -------------------------------------------------------------------------- */

export const getTournaments = expressAsyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page ?? 1, 10), 1);
  const limit = Math.min(parseInt(req.query.limit ?? 50, 10), 100);

  const sortRaw = (req.query.sort || "-createdAt").toString();
  const sortSpecRaw = parseSort(sortRaw);
  const sortSpec = Object.keys(sortSpecRaw).length
    ? sortSpecRaw
    : { createdAt: -1, _id: -1 };

  const { keyword = "", status = "", sportType, groupId } = req.query;

  const TZ =
    (typeof req.query.tz === "string" &&
      isValidTZ(req.query.tz) &&
      req.query.tz) ||
    "Asia/Ho_Chi_Minh";

  const match = {};
  if (keyword.trim()) match.name = { $regex: keyword.trim(), $options: "i" };
  if (sportType) match.sportType = Number(sportType);
  if (groupId) match.groupId = Number(groupId);

  const skip = (page - 1) * limit;

  const mapStatus = {
    upcoming: "upcoming",
    sắp: "upcoming",
    sap: "upcoming",
    ongoing: "ongoing",
    live: "ongoing",
    đang: "ongoing",
    dang: "ongoing",
    finished: "finished",
    done: "finished",
    past: "finished",
    đã: "finished",
    da: "finished",
  };
  const wantedStatus = mapStatus[String(status || "").toLowerCase()] || null;

  const sortFinal = { statusPriority: 1, ...sortSpec };

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        _startInstant: { $ifNull: ["$startAt", "$startDate"] },
        _endInstant: { $ifNull: ["$endAt", "$endDate"] },
      },
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $ne: ["$finishedAt", null] }, then: "finished" },
              { case: { $lt: ["$$NOW", "$_startInstant"] }, then: "upcoming" },
              { case: { $gt: ["$$NOW", "$_endInstant"] }, then: "finished" },
            ],
            default: "ongoing",
          },
        },
      },
    },
    {
      $addFields: {
        statusPriority: {
          $switch: {
            branches: [
              { case: { $eq: ["$status", "ongoing"] }, then: 0 },
              { case: { $eq: ["$status", "upcoming"] }, then: 1 },
            ],
            default: 2,
          },
        },
      },
    },
    ...(wantedStatus ? [{ $match: { status: wantedStatus } }] : []),
    {
      $facet: {
        data: [
          { $sort: sortFinal },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: "registrations",
              let: { tid: "$_id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$tournament", "$$tid"] } } },
                { $group: { _id: null, c: { $sum: 1 } } },
              ],
              as: "_rc",
            },
          },
          {
            $addFields: {
              registered: { $ifNull: [{ $arrayElemAt: ["$_rc.c", 0] }, 0] },
            },
          },
          { $project: { _rc: 0, _startInstant: 0, _endInstant: 0 } },
        ],
        total: [{ $count: "count" }],
      },
    },
  ];

  const agg = await Tournament.aggregate(pipeline);
  const list = agg?.[0]?.data || [];
  const total = agg?.[0]?.total?.[0]?.count || 0;

  res.json({ total, page, limit, list, tz: TZ });
});

// Ví dụ: "THÀNH NAM CUP Lần 1 - Đôi hỗn hợp 6.0" => "TNCL1"
const autoGenerateTournamentCode = (name) => {
  if (!name) return "";
  // Chỉ lấy phần trước dấu '-'
  const base = String(name).split("-")[0] || "";
  const tokens = base
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  if (!tokens.length) return "";

  const code = tokens
    .map((token) => {
      // Lấy ký tự chữ / số đầu tiên trong từ
      const match = token.match(/[A-Za-z0-9]/);
      return match ? match[0].toUpperCase() : "";
    })
    .join("");

  // Nếu < 3 ký tự thì coi như không hợp lệ, trả về rỗng để BE xử lý tiếp
  return code.length >= 3 ? code : "";
};

export const adminCreateTournament = expressAsyncHandler(async (req, res) => {
  const incoming = { ...(req.body || {}) };

  if (incoming.scoringScope) {
    const type =
      String(incoming.scoringScope.type || "national").toLowerCase() ===
      "provinces"
        ? "provinces"
        : "national";
    if (type === "national") {
      if (
        Object.prototype.hasOwnProperty.call(incoming.scoringScope, "provinces")
      ) {
        delete incoming.scoringScope.provinces;
      }
      incoming.scoringScope.type = "national";
    } else {
      const arr = Array.isArray(incoming.scoringScope.provinces)
        ? incoming.scoringScope.provinces
        : [];
      incoming.scoringScope = {
        type: "provinces",
        provinces: Array.from(
          new Set(arr.map((s) => String(s).trim()).filter(Boolean))
        ),
      };
    }
  }

  if (Object.prototype.hasOwnProperty.call(incoming, "bankShortName")) {
    incoming.bankShortName = String(incoming.bankShortName || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "bankAccountNumber")) {
    incoming.bankAccountNumber = String(
      incoming.bankAccountNumber || ""
    ).replace(/\D/g, "");
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "bankAccountName")) {
    incoming.bankAccountName = String(incoming.bankAccountName || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "registrationFee")) {
    const raw = String(incoming.registrationFee ?? "").replace(/[^0-9.-]/g, "");
    const fee = Number(raw);
    incoming.registrationFee =
      Number.isFinite(fee) && fee >= 0 ? Math.floor(fee) : 0;
  }

  if (incoming.ageRestriction) {
    const ar = incoming.ageRestriction || {};
    const enabled = !!(
      ar.enabled === true ||
      ar.enabled === "true" ||
      ar.enabled === 1 ||
      ar.enabled === "1" ||
      ar.enabled === "on"
    );
    incoming.ageRestriction = {
      enabled,
      minAge: Number.isFinite(+ar.minAge)
        ? Math.max(0, Math.min(100, Math.trunc(+ar.minAge)))
        : undefined,
      maxAge: Number.isFinite(+ar.maxAge)
        ? Math.max(0, Math.min(100, Math.trunc(+ar.maxAge)))
        : undefined,
    };
  }

  if (Object.prototype.hasOwnProperty.call(incoming, "requireKyc")) {
    const v = incoming.requireKyc;
    incoming.requireKyc = !!(
      v === true ||
      v === "true" ||
      v === 1 ||
      v === "1" ||
      v === "on"
    );
  }

  if (Object.prototype.hasOwnProperty.call(incoming, "code")) {
    // chuẩn hoá mã người dùng nhập
    const raw = String(incoming.code || "")
      .trim()
      .toUpperCase();
    if (!raw) {
      delete incoming.code; // coi như không gửi
    } else {
      incoming.code = raw;
    }
  }

  // Nếu chưa có code (user không nhập) thì auto từ tên giải
  if (!incoming.code && incoming.name) {
    const auto = autoGenerateTournamentCode(incoming.name);
    if (auto) {
      incoming.code = auto;
    }
  }

  // Nếu có code (tự sinh hoặc user nhập) thì phải >= 3 ký tự
  if (incoming.code && incoming.code.length < 3) {
    res.status(400);
    throw new Error("Mã giải tối thiểu 3 ký tự.");
  }

  const data = validate(createSchema, incoming);

  data.contactHtml = cleanHTML(data.contactHtml);
  data.contentHtml = cleanHTML(data.contentHtml);
  if (data._meta) delete data._meta;

  if (!req.user?._id) {
    res.status(401);
    throw new Error("Unauthenticated");
  }

  const t = await Tournament.create({ ...data, createdBy: req.user._id });

  res.status(201).json(t);

  setImmediate(() => {
    scheduleTournamentCountdown(t).catch((e) => {
      console.error(
        "[adminCreateTournament] scheduleTournamentCountdown failed:",
        e?.message || e,
        {
          tournamentId: String(t._id),
        }
      );
    });
  });

  setImmediate(async () => {
    try {
      const tele = t.tele || {};
      const teleEnabled = tele.enabled !== false;
      if (!teleEnabled) return;

      const hubChatId = tele.hubChatId || process.env.TELEGRAM_HUB_CHAT_ID;
      if (!hubChatId) {
        console.error(
          "[adminCreateTournament] Missing TELEGRAM_HUB_CHAT_ID; skip creating topic",
          {
            tournamentId: String(t._id),
          }
        );
        return;
      }

      const topicId = await createForumTopic({
        chatId: hubChatId,
        name: t.name,
      });

      let inviteLink = tele.inviteLink;
      try {
        inviteLink =
          inviteLink ||
          (await createInviteLink({ chatId: hubChatId, name: t.name }));
      } catch (ie) {
        console.error(
          "[adminCreateTournament] createInviteLink failed (non-fatal):",
          ie?.message || ie,
          { tournamentId: String(t._id) }
        );
      }

      await Tournament.updateOne(
        { _id: t._id },
        {
          $set: {
            tele: {
              ...tele,
              hubChatId,
              topicId,
              inviteLink,
              enabled: teleEnabled,
            },
          },
        }
      );
      console.log("[adminCreateTournament] created forum topic", {
        tournamentId: String(t._id),
        topicId,
        hubChatId,
        name: t.name,
      });
    } catch (e) {
      console.error(
        "[adminCreateTournament] create topic failed:",
        e?.message || e,
        {
          tournamentId: String(t._id),
          name: t.name,
        }
      );
    }
  });
});

export const adminUpdateTournament = expressAsyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  const incoming = { ...(req.body || {}) };

  if (incoming.scoringScope) {
    const type =
      String(incoming.scoringScope.type || "national").toLowerCase() ===
      "provinces"
        ? "provinces"
        : "national";
    if (type === "national") {
      if (
        Object.prototype.hasOwnProperty.call(incoming.scoringScope, "provinces")
      ) {
        delete incoming.scoringScope.provinces;
      }
      incoming.scoringScope.type = "national";
    } else {
      const arr = Array.isArray(incoming.scoringScope.provinces)
        ? incoming.scoringScope.provinces
        : [];
      incoming.scoringScope = {
        type: "provinces",
        provinces: Array.from(
          new Set(arr.map((s) => String(s).trim()).filter(Boolean))
        ),
      };
    }
  }

  if (Object.prototype.hasOwnProperty.call(incoming, "bankShortName")) {
    incoming.bankShortName = String(incoming.bankShortName || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "bankAccountNumber")) {
    incoming.bankAccountNumber = String(
      incoming.bankAccountNumber || ""
    ).replace(/\D/g, "");
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "bankAccountName")) {
    incoming.bankAccountName = String(incoming.bankAccountName || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "registrationFee")) {
    const raw = String(incoming.registrationFee ?? "").replace(/[^0-9.-]/g, "");
    const fee = Number(raw);
    incoming.registrationFee =
      Number.isFinite(fee) && fee >= 0 ? Math.floor(fee) : 0;
  }

  if (incoming.ageRestriction) {
    const ar = incoming.ageRestriction || {};
    const enabled =
      ar.enabled === undefined
        ? undefined
        : !!(
            ar.enabled === true ||
            ar.enabled === "true" ||
            ar.enabled === 1 ||
            ar.enabled === "1" ||
            ar.enabled === "on"
          );
    incoming.ageRestriction = {
      ...(enabled === undefined ? {} : { enabled }),
      ...(ar.minAge !== undefined
        ? { minAge: Math.max(0, Math.min(100, Math.trunc(+ar.minAge))) }
        : {}),
      ...(ar.maxAge !== undefined
        ? { maxAge: Math.max(0, Math.min(100, Math.trunc(+ar.maxAge))) }
        : {}),
    };
  }

  if (Object.prototype.hasOwnProperty.call(incoming, "requireKyc")) {
    const v = incoming.requireKyc;
    incoming.requireKyc = !!(
      v === true ||
      v === "true" ||
      v === 1 ||
      v === "1" ||
      v === "on"
    );
  }

  if (Object.prototype.hasOwnProperty.call(incoming, "code")) {
    const raw = String(incoming.code || "")
      .trim()
      .toUpperCase();

    if (raw && raw.length < 3) {
      res.status(400);
      throw new Error("Mã giải tối thiểu 3 ký tự.");
    }

    // Nếu user gửi rỗng, cho phép xoá field => delete để không set ""
    if (!raw) {
      delete incoming.code;
    } else {
      incoming.code = raw;
    }
  }

  const payload = validate(updateSchema, incoming);
  if (!Object.keys(payload).length) {
    res.status(400);
    throw new Error("Không có dữ liệu để cập nhật");
  }

  if (typeof payload.contactHtml === "string")
    payload.contactHtml = cleanHTML(payload.contactHtml);
  if (typeof payload.contentHtml === "string")
    payload.contentHtml = cleanHTML(payload.contentHtml);
  if (payload._meta) delete payload._meta;

  let t = await Tournament.findByIdAndUpdate(
    req.params.id,
    { $set: payload },
    { new: true, runValidators: true, context: "query" }
  );
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  (function autoDeriveStatus() {
    const tz = t.timezone || "Asia/Ho_Chi_Minh";
    const now = DateTime.now().setZone(tz);
    const start = t.startDate
      ? DateTime.fromJSDate(t.startDate).setZone(tz)
      : null;
    const end = t.endDate ? DateTime.fromJSDate(t.endDate).setZone(tz) : null;

    let nextStatus = t.status;
    if (start && end) {
      if (now < start) nextStatus = "upcoming";
      else if (now > end) nextStatus = "finished";
      else nextStatus = "ongoing";
    } else if (start) {
      nextStatus = now >= start ? "ongoing" : "upcoming";
    } else if (end) {
      nextStatus = now <= end ? "ongoing" : "finished";
    }

    const shouldSetFinishedAt = nextStatus === "finished";
    const finishedAt = shouldSetFinishedAt ? now.toJSDate() : null;

    if (
      nextStatus !== t.status ||
      (shouldSetFinishedAt && !t.finishedAt) ||
      (!shouldSetFinishedAt && t.finishedAt)
    ) {
      t.status = nextStatus;
      t.finishedAt = finishedAt;
      return Tournament.updateOne(
        { _id: t._id },
        { $set: { status: nextStatus, finishedAt } }
      );
    }
    return Promise.resolve();
  })()
    .catch((e) => {
      console.error(
        "[adminUpdateTournament] autoDeriveStatus failed:",
        e?.message || e,
        {
          tournamentId: String(t._id),
        }
      );
    })
    .finally(async () => {
      res.json(t);

      setImmediate(() => {
        scheduleTournamentCountdown(t).catch((e) => {
          console.error(
            "[adminUpdateTournament] scheduleTournamentCountdown failed:",
            e?.message || e,
            {
              tournamentId: String(t._id),
            }
          );
        });
      });

      const tele = t.tele || {};
      const teleEnabled = tele.enabled !== false;
      const hasTopic = !!tele.topicId;
      const forceCreate =
        String(req.query?.forceCreateTopic || "0").trim() === "1" ||
        String(req.body?.forceCreateTopic || "0").trim() === "1";

      if ((teleEnabled && !hasTopic) || forceCreate) {
        const hubChatId = tele.hubChatId || process.env.TELEGRAM_HUB_CHAT_ID;
        if (!hubChatId) {
          console.error(
            "[adminUpdateTournament] Missing hubChatId for topic creation",
            {
              tournamentId: String(t._id),
              hasTele: !!t.tele,
            }
          );
        } else {
          setImmediate(async () => {
            try {
              const topicId = await createForumTopic({
                chatId: hubChatId,
                name: t.name,
              });

              let inviteLink = tele.inviteLink;
              try {
                inviteLink =
                  inviteLink ||
                  (await createInviteLink({ chatId: hubChatId, name: t.name }));
              } catch (ie) {
                console.error(
                  "[adminUpdateTournament] createInviteLink failed (non-fatal):",
                  ie?.message || ie,
                  { tournamentId: String(t._id) }
                );
              }

              await Tournament.updateOne(
                { _id: t._id },
                {
                  $set: {
                    tele: {
                      ...tele,
                      hubChatId,
                      topicId,
                      inviteLink,
                      enabled: teleEnabled,
                    },
                  },
                }
              );

              console.log("[adminUpdateTournament] created forum topic", {
                tournamentId: String(t._id),
                topicId,
                hubChatId,
                name: t.name,
              });
            } catch (e) {
              console.error(
                "[adminUpdateTournament] ensure topic failed:",
                e?.message || e,
                {
                  tournamentId: String(t._id),
                  name: t.name,
                }
              );
            }
          });
        }
      }
    });
});

export const getTournamentById = expressAsyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }
  const t = await Tournament.findById(req.params.id);
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  res.json(t);
});

export const deleteTournament = expressAsyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }
  const t = await Tournament.findByIdAndDelete(req.params.id);
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  res.json({ message: "Tournament removed" });
});

async function finalizeOneTournament(id) {
  const t0 = await Tournament.findById(id).select("_id status timezone").lean();
  if (!t0) return { ok: false, reason: "not_found" };
  if (t0.status === "finished")
    return { ok: false, reason: "already_finished" };

  const tz = isValidTZ(t0.timezone) ? t0.timezone : "Asia/Ho_Chi_Minh";

  const nowLocal = DateTime.now().setZone(tz);
  const endOfLocalDay = nowLocal.endOf("day");

  const t = await Tournament.findOneAndUpdate(
    { _id: id, status: { $ne: "finished" } },
    {
      $set: {
        status: "finished",
        finishedAt: nowLocal.toJSDate(),
        endDate: nowLocal.toJSDate(),
        endAt: endOfLocalDay.toJSDate(),
      },
    },
    { new: true }
  );
  if (!t) return { ok: false, reason: "race_finished" };

  const regs = await Registration.find({ tournament: id })
    .select("player1 player2")
    .lean();
  const userIds = Array.from(
    new Set(
      regs.flatMap((r) => [r.player1, r.player2].filter(Boolean)).map(String)
    )
  );

  await addTournamentReputationBonus({
    userIds,
    tournamentId: id,
    amount: 10,
  });

  return { ok: true, tournamentId: String(id), playerCount: userIds.length };
}

export const finishTournament = expressAsyncHandler(async (req, res) => {
  const r = await finalizeOneTournament(req.params.id);
  if (!r.ok && r.reason === "not_found") {
    res.status(404);
    throw new Error("Tournament not found");
  }
  res.json(r);
});

export const finishExpiredTournaments = expressAsyncHandler(
  async (_req, res) => {
    const now = new Date();
    const ids = await Tournament.find({
      status: { $ne: "finished" },
      endAt: { $lte: now },
    })
      .select("_id")
      .lean();

    let finished = 0;
    for (const { _id } of ids) {
      const r = await finalizeOneTournament(_id);
      if (r.ok) finished++;
    }
    res.json({ checked: ids.length, finished });
  }
);

export const planAuto = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const t = await Tournament.findById(id).lean();
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const {
    expectedTeams,
    allowGroup = true,
    allowPO = true,
    allowKO = true,
  } = req.body || {};
  const plan = autoPlan({
    expectedTeams: Number(expectedTeams || t.expected || 0),
    allowGroup,
    allowPO,
    allowKO,
  });

  res.json(plan);
});

const isByeSeed = (s) => {
  if (!s) return false;
  const t = String(s.type || "").toLowerCase();
  if (t === "bye") return true;
  const lbl = (s.label || s.name || "").toString().toUpperCase();
  if (lbl === "BYE") return true;
  return false;
};
function normalizeRule(r) {
  if (!r) {
    return {
      bestOf: 1,
      pointsToWin: 11,
      winByTwo: true,
      cap: { mode: "none", points: null },
    };
  }
  const bestOf = Number(r.bestOf ?? 1);
  const pointsToWin = Number(r.pointsToWin ?? 11);
  const winByTwo = r.winByTwo !== false;
  const rawMode = String(r?.cap?.mode ?? "none").toLowerCase();
  const mode = ["none", "soft", "hard"].includes(rawMode) ? rawMode : "none";
  let points = r?.cap?.points;
  if (mode === "none") points = null;
  else {
    const n = Number(points);
    points = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  return { bestOf, pointsToWin, winByTwo, cap: { mode, points } };
}
function applyRuleToMatch(mDoc, ruleObj) {
  const r = normalizeRule(ruleObj);
  mDoc.rules = r;
  mDoc.bestOf = r.bestOf;
  mDoc.pointsToWin = r.pointsToWin;
  mDoc.winByTwo = r.winByTwo;
  mDoc.capMode = r.cap.mode;
  mDoc.capPoints = r.cap.points;
}
async function autoAdvanceByesForBracket(bracketId, session) {
  if (!bracketId) return;
  const bracket = await Bracket.findById(bracketId).session(session);
  const baseRule = normalizeRule(bracket?.rules);
  const roundRules = Array.isArray(bracket?.config?.roundRules)
    ? bracket.config.roundRules.map((r) => normalizeRule(r))
    : [];
  const ruleForRound = (roundNum) => {
    const idx = Math.max(0, Number(roundNum || 1) - 1);
    return roundRules[idx] || baseRule;
  };
  let matches = await Match.find({ bracket: bracketId }).session(session);

  const idOf = (x) => String(x?._id || x || "");
  const nextMap = new Map();
  for (const nx of matches) {
    const pA = idOf(nx.previousA);
    const pB = idOf(nx.previousB);
    if (pA) {
      if (!nextMap.has(pA)) nextMap.set(pA, []);
      nextMap.get(pA).push({ match: nx, side: "A" });
    }
    if (pB) {
      if (!nextMap.has(pB)) nextMap.set(pB, []);
      nextMap.get(pB).push({ match: nx, side: "B" });
    }
  }

  let changed = true;
  let pass = 0;
  while (changed && pass < 5) {
    changed = false;
    pass += 1;

    for (const m of matches) {
      const status = String(m.status || "").toLowerCase();
      const aBye = isByeSeed(m.seedA);
      const bBye = isByeSeed(m.seedB);
      if (aBye === bBye) continue;

      const winnerSide = aBye ? "B" : "A";
      const advSeed = aBye ? m.seedB : m.seedA;
      const thisRound = Number(m.round || 1);

      if (status !== "finished" || m.winner !== winnerSide) {
        m.status = "finished";
        m.winner = winnerSide;
        m.startedAt = m.startedAt || new Date();
        m.finishedAt = new Date();
        m.auto = true;
        m.autoReason = "bye";
        const curRule = ruleForRound(thisRound);
        applyRuleToMatch(m, curRule);
        await m.save({ session });
        changed = true;
      }

      const followers = nextMap.get(idOf(m)) || [];
      for (const { match: nx, side } of followers) {
        const sideKeySeed = side === "A" ? "seedA" : "seedB";
        const sideKeyPrev = side === "A" ? "previousA" : "previousB";
        if (idOf(nx[sideKeyPrev]) === idOf(m)) {
          nx[sideKeySeed] = advSeed;
          nx[sideKeyPrev] = undefined;
          const nxRound = Number(nx.round || thisRound + 1);
          const nxRule = ruleForRound(nxRound);
          applyRuleToMatch(nx, nxRule);
          await nx.save({ session });
          changed = true;
        }
      }
    }
    if (changed) {
      matches = await Match.find({ bracket: bracketId }).session(session);
    }
  }
}

const toBool = (v, def = false) => {
  if (v === undefined || v === null) return def;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(s);
};

const normalizePlanRule = (rules) => {
  if (!rules) return undefined;
  const bestOf = Number(rules.bestOf ?? 1);
  const pointsToWin = Number(rules.pointsToWin ?? 11);
  const winByTwo = rules.winByTwo !== false;
  const rawMode = String(rules?.cap?.mode ?? "none").toLowerCase();
  const mode = ["none", "soft", "hard"].includes(rawMode) ? rawMode : "none";
  let points = rules?.cap?.points;
  if (mode === "none") points = null;
  else {
    const n = Number(points);
    points = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  return { bestOf, pointsToWin, winByTwo, cap: { mode, points } };
};

const normalizePlanRoundRules = (arr, fallback, maxRounds) => {
  const fb = normalizePlanRule(fallback);
  const rounds = Math.max(1, Number(maxRounds) || 1);

  if (!Array.isArray(arr) || !arr.length) {
    return Array.from({ length: rounds }, () => fb);
  }

  const out = arr.map((r) => normalizePlanRule(r || fallback) || fb);
  while (out.length < rounds) out.push(fb);
  return out.slice(0, rounds);
};

export const planGet = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  const t = await Tournament.findById(id).lean();
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const plan = t.drawPlan || null;
  res.json({ ok: true, plan });
});

export const planUpdate = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  const t = await Tournament.findById(id);
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const { groups, po, ko } = req.body || {};
  if (!groups && !po && !ko) {
    res.status(400);
    throw new Error("No plan data to update");
  }

  const nextPlan = {};

  // ===== groups (giữ nguyên) =====
  if (groups) {
    const g = { ...groups };

    if (g.count !== undefined) g.count = Number(g.count) || 0;
    if (g.totalTeams !== undefined) g.totalTeams = Number(g.totalTeams) || 0;
    if (g.qualifiersPerGroup !== undefined) {
      g.qualifiersPerGroup = Number(g.qualifiersPerGroup) || 1;
    }
    if (!Array.isArray(g.groupSizes) || !g.groupSizes.length) {
      delete g.groupSizes;
    }
    if (g.rules) {
      g.rules = normalizePlanRule(g.rules);
    }

    nextPlan.groups = g;
  }

  // ===== PO (giữ nguyên) =====
  if (po) {
    const p = { ...po };
    if (p.drawSize !== undefined) p.drawSize = Number(p.drawSize) || 0;
    const maxRounds = p.maxRounds !== undefined ? Number(p.maxRounds) || 1 : 1;
    p.maxRounds = maxRounds;

    p.rules = normalizePlanRule(p.rules);
    p.roundRules = normalizePlanRoundRules(p.roundRules, p.rules, maxRounds);

    nextPlan.po = p;
  }

  // ===== KO (sửa ở đây) =====
  if (ko) {
    const k = { ...ko };

    if (k.drawSize !== undefined) k.drawSize = Number(k.drawSize) || 0;

    k.rules = normalizePlanRule(k.rules);
    k.semiRules = normalizePlanRule(k.semiRules);
    k.finalRules = normalizePlanRule(k.finalRules);

    // ✅ NEW: nhận flag trận tranh hạng 3–4
    // FE có thể gửi: thirdPlaceEnabled hoặc thirdPlace
    if (k.thirdPlaceEnabled !== undefined || k.thirdPlace !== undefined) {
      k.thirdPlaceEnabled = toBool(
        k.thirdPlaceEnabled !== undefined ? k.thirdPlaceEnabled : k.thirdPlace
      );
    } else if (k.thirdPlaceEnabled === undefined) {
      // default: false
      k.thirdPlaceEnabled = false;
    }
    delete k.thirdPlace; // tránh lưu alias rác nếu FE dùng key 'thirdPlace'

    // ✅ NEW: rule riêng cho trận tranh 3–4 (tuỳ chọn)
    if (k.thirdPlaceRules) {
      k.thirdPlaceRules = normalizePlanRule(k.thirdPlaceRules);
    } else if (k.thirdPlaceEnabled) {
      // nếu bật mà không gửi rule riêng -> để undefined, BE/builder có thể fallback về ko.finalRules hoặc ko.rules
      k.thirdPlaceRules = undefined;
    }

    nextPlan.ko = k;
  }

  nextPlan.savedAt = new Date();

  t.drawPlan = nextPlan;
  await t.save();

  res.json({ ok: true, plan: t.drawPlan });
});

export const planCommit = expressAsyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    if (!isObjectId(id)) {
      res.status(400);
      throw new Error("Invalid ID");
    }

    const t = await Tournament.findById(id).session(session);
    if (!t) {
      res.status(404);
      throw new Error("Tournament not found");
    }

    const body = req.body || {};
    let { groups, po, ko } = body;

    const force =
      body.force === true ||
      body.force === "true" ||
      body.force === 1 ||
      body.force === "1";

    const hasBodyPlan = Boolean(groups || po || ko);

    if (!hasBodyPlan && t.drawPlan) {
      groups = t.drawPlan.groups || undefined;
      po = t.drawPlan.po || undefined;
      ko = t.drawPlan.ko || undefined;
    }

    const hasGroup = Boolean(groups && Number(groups.count) > 0);
    const hasPO = Boolean(po && Number(po.drawSize) > 0);
    const hasKO = Boolean(ko && Number(ko.drawSize) > 0);

    if (!hasGroup && !hasPO && !hasKO) {
      res.status(400);
      throw new Error("Nothing to create from plan");
    }

    if (force) {
      try {
        await Bracket.deleteMany({ tournament: t._id }).session(session);
      } catch (_) {
        // ignore
      }
    }

    if (hasBodyPlan) {
      const toSave = {};

      if (groups) {
        toSave.groups = {
          ...groups,
          rules: normalizePlanRule(groups.rules),
        };
      }

      if (po) {
        const poMaxRounds =
          po.maxRounds !== undefined ? Number(po.maxRounds) || 1 : 1;
        toSave.po = {
          ...po,
          maxRounds: poMaxRounds,
          rules: normalizePlanRule(po.rules),
          roundRules: normalizePlanRoundRules(
            po.roundRules,
            po.rules,
            poMaxRounds
          ),
        };
      }

      if (ko) {
        // ✅ NEW: normalize flag + rules tranh hạng 3–4
        const thirdPlaceEnabled = toBool(
          ko.thirdPlaceEnabled !== undefined
            ? ko.thirdPlaceEnabled
            : ko.thirdPlace,
          false
        );

        toSave.ko = {
          ...ko,
          rules: normalizePlanRule(ko.rules),
          semiRules: normalizePlanRule(ko.semiRules),
          finalRules: normalizePlanRule(ko.finalRules),
          thirdPlaceEnabled,
          thirdPlaceRules: normalizePlanRule(ko.thirdPlaceRules),
        };

        // sạch alias cũ nếu FE gửi 'thirdPlace'
        delete toSave.ko.thirdPlace;
      }

      toSave.savedAt = new Date();
      t.drawPlan = toSave;
      await t.save({ session });

      // dùng bản normalized để build bracket
      groups = toSave.groups || groups;
      po = toSave.po || po;
      ko = toSave.ko || ko;
    }

    const created = { groupBracket: null, poBracket: null, koBracket: null };

    let orderCounter = 1;
    const groupOrder = hasGroup ? orderCounter++ : null;
    const poOrder = hasPO ? orderCounter++ : null;
    const koOrder = hasKO ? orderCounter++ : null;

    // ===== build group (giữ nguyên) =====
    if (hasGroup) {
      const payload = {
        tournamentId: t._id,
        name: "Group Stage",
        order: groupOrder,
        stage: groupOrder,
        groupCount: Number(groups.count),
        groupSize:
          Number(groups.totalTeams || 0) > 0
            ? undefined
            : Number(groups.size || 0) || undefined,
        totalTeams: Number(groups.totalTeams || 0) || undefined,
        groupSizes: Array.isArray(groups.groupSizes)
          ? groups.groupSizes
          : undefined,
        qualifiersPerGroup: Number(groups.qualifiersPerGroup || 1),
        rules: normalizePlanRule(groups.rules),
        session,
      };
      created.groupBracket = await buildGroupBracket(payload);
    }

    // ===== build PO (giữ nguyên) =====
    if (hasPO) {
      const drawSize = Number(po.drawSize);
      const maxRounds = Math.max(
        1,
        Number(
          po.maxRounds ||
            (Array.isArray(po.roundRules) ? po.roundRules.length : 1)
        ) || 1
      );
      const firstRoundSeeds = Array.isArray(po.seeds) ? po.seeds : [];

      const poRules = normalizePlanRule(po.rules);
      const poRoundRules = normalizePlanRoundRules(
        po.roundRules,
        po.rules,
        maxRounds
      );

      const { bracket } = await buildRoundElimBracket({
        tournamentId: t._id,
        name: po.name || "Pre-Qualifying",
        order: poOrder,
        stage: poOrder,
        drawSize,
        maxRounds,
        firstRoundSeeds,
        rules: poRules,
        roundRules: poRoundRules,
        session,
      });
      created.poBracket = bracket;
      await autoAdvanceByesForBracket(bracket._id, session);
    }

    // ===== build KO (thêm thirdPlace) =====
    if (hasKO) {
      const drawSize = Number(ko.drawSize);
      const firstRoundSeeds = Array.isArray(ko.seeds) ? ko.seeds : [];

      const koRules = normalizePlanRule(ko.rules);
      const koSemiRules = normalizePlanRule(ko.semiRules);
      const koFinalRules = normalizePlanRule(ko.finalRules);

      // ✅ flag + rule tranh hạng 3–4 (đã normalize ở trên)
      const thirdPlace = toBool(
        ko.thirdPlaceEnabled !== undefined
          ? ko.thirdPlaceEnabled
          : ko.thirdPlace,
        false
      );

      const thirdPlaceRules = normalizePlanRule(ko.thirdPlaceRules);

      const { bracket } = await buildKnockoutBracket({
        tournamentId: t._id,
        name: ko.name || "Knockout",
        order: koOrder,
        stage: koOrder,
        drawSize,
        firstRoundSeeds,
        rules: koRules,
        semiRules: koSemiRules,
        finalRules: koFinalRules,

        // ✅ tham số mới – cần dùng trong buildKnockoutBracket
        thirdPlace,
        thirdPlaceRules,

        session,
      });
      created.koBracket = bracket;
      await autoAdvanceByesForBracket(bracket._id, session);
    }

    await session.commitTransaction();
    res.json({
      ok: true,
      created: {
        groupBracketId: created.groupBracket?._id || null,
        poBracketId: created.poBracket?._id || null,
        koBracketId: created.koBracket?._id || null,
      },
    });
  } catch (e) {
    await session.abortTransaction().catch(() => {});
    res.status(500);
    throw new Error(`Commit plan failed: ${e?.message || e}`);
  } finally {
    session.endSession();
  }
});

export const updateTournamentOverlay = expressAsyncHandler(async (req, res) => {
  const t = await Tournament.findById(req.params.id);
  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  const allow = [
    "theme",
    "accentA",
    "accentB",
    "corner",
    "rounded",
    "shadow",
    "showSets",
    "fontFamily",
    "nameScale",
    "scoreScale",
    "customCss",
    "logoUrl",
  ];
  t.overlay = t.overlay || {};
  for (const k of allow) {
    if (k in req.body) t.overlay[k] = req.body[k];
  }
  await t.save();
  res.json({ ok: true, overlay: t.overlay });
});

export const listTournamentRefereesInScope = expressAsyncHandler(
  async (req, res) => {
    const { id } = req.params;
    const me = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, id);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const qRaw = String(req.query?.q || "").trim();
    const limit = Math.min(
      Math.max(parseInt(req.query?.limit, 10) || 50, 1),
      200
    );

    const orQ = [];
    if (qRaw) {
      const esc = qRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(esc, "i");
      orQ.push(
        { nickname: rx },
        { nickName: rx },
        { name: rx },
        { fullName: rx },
        { email: rx },
        { phone: rx }
      );
    }

    const items = await User.find({
      isDeleted: { $ne: true },
      role: "referee",
      "referee.tournaments": new mongoose.Types.ObjectId(id),
      ...(orQ.length ? { $or: orQ } : {}),
    })
      .select("name fullName nickname nickName email phone avatar province")
      .sort({ nickname: 1, name: 1, createdAt: -1 })
      .limit(limit)
      .collation({ locale: "vi", strength: 1 })
      .lean();

    res.json({ items });
  }
);

const asObjId = (id) => new mongoose.Types.ObjectId(id);
const isValidId = (id) => mongoose.isValidObjectId(id);
const normIds = (arr) =>
  Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map((x) => (isValidId(x) ? String(x) : ""))
        .filter(Boolean)
    )
  );

export const upsertTournamentReferees = async (req, res, next) => {
  try {
    const { tid } = req.params;
    if (!isValidId(tid)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }

    const me = req.user;
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, tid);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const TID = asObjId(tid);

    const { set, add = [], remove = [] } = req.body || {};
    const addIds = Array.isArray(set) ? normIds(set) : normIds(add);
    const removeIds = Array.isArray(set) ? [] : normIds(remove);

    if (Array.isArray(set)) {
      const current = await User.find({
        isDeleted: { $ne: true },
        "referee.tournaments": TID,
      })
        .select("_id")
        .lean();

      const curSet = new Set(current.map((u) => String(u._id)));
      const nextSet = new Set(addIds);

      const toAdd = Array.from(nextSet).filter((id) => !curSet.has(id));
      const toRemove = Array.from(curSet).filter((id) => !nextSet.has(id));

      if (toAdd.length) {
        await User.updateMany(
          { _id: { $in: toAdd } },
          { $addToSet: { "referee.tournaments": TID } }
        );
        await User.updateMany(
          { _id: { $in: toAdd }, role: { $nin: ["admin", "referee"] } },
          { $set: { role: "referee" } }
        );
      }
      if (toRemove.length) {
        await User.updateMany(
          { _id: { $in: toRemove } },
          { $pull: { "referee.tournaments": TID } }
        );
      }
    } else {
      if (addIds.length) {
        await User.updateMany(
          { _id: { $in: addIds } },
          { $addToSet: { "referee.tournaments": TID } }
        );
        await User.updateMany(
          { _id: { $in: addIds }, role: { $nin: ["admin", "referee"] } },
          { $set: { role: "referee" } }
        );
      }
      if (removeIds.length) {
        await User.updateMany(
          { _id: { $in: removeIds } },
          { $pull: { "referee.tournaments": TID } }
        );
      }
    }

    const list = await User.find({
      isDeleted: { $ne: true },
      "referee.tournaments": TID,
    })
      .select("_id name nickname email phone avatar role province")
      .lean();

    res.json(list);
  } catch (err) {
    next(err);
  }
};
