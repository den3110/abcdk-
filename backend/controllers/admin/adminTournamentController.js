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
import Bracket from "../../models/bracketModel.js"; // <-- thêm dòng này
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
  // NEW: phạm vi chấm đa tỉnh
  scoringScope: "Phạm vi chấm",
  "scoringScope.type": "Loại phạm vi chấm",
  "scoringScope.provinces": "Các tỉnh áp dụng",
  // NEW: thanh toán
  bankShortName: "Tên ngân hàng",
  bankAccountNumber: "Số tài khoản",
  bankAccountName: "Tên chủ tài khoản",
  registrationFee: "Phí đăng ký (VND)",
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
const dateISO = Joi.date().iso();
const boolLoose = Joi.boolean()
  .truthy(1, "1", "true", "yes", "y", "on")
  .falsy(0, "0", "false", "no", "n", "off");

// NEW: schema phạm vi chấm đa tỉnh
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

/* ------------ NEW: các field thanh toán (SePay VietQR compatible) --------- */
const bankShortName = Joi.string()
  .trim()
  .max(64)
  .allow("")
  .empty("") // coi "" như undefined để .with() không kích hoạt
  .label(FIELD_LABELS.bankShortName);

const bankAccountNumber = Joi.string()
  .pattern(/^\d{4,32}$/) // 4–32 chữ số
  .messages({
    "string.pattern.base": "{{#label}} phải gồm 4–32 chữ số (0–9)",
  })
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

/* --------------------------------- CREATE --------------------------------- */
const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required().label(FIELD_LABELS.name),
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
  // end >= start
  endDate: dateISO
    .min(Joi.ref("startDate"))
    .required()
    .label(FIELD_LABELS.endDate),

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

  // NEW: phạm vi chấm đa tỉnh
  scoringScope: scoringScopeCreate,

  // NEW: thanh toán
  bankShortName: bankShortName.default(""),
  bankAccountNumber: bankAccountNumber.default(""),
  bankAccountName: bankAccountName.default(""),
  registrationFee: registrationFee.default(0),
})
  // Khi đã có 1 field ngân hàng ⇒ phải có đủ 3
  .with("bankShortName", ["bankAccountNumber", "bankAccountName"])
  .with("bankAccountNumber", ["bankShortName", "bankAccountName"])
  .with("bankAccountName", ["bankShortName", "bankAccountNumber"])
  .messages(COMMON_MESSAGES)
  .custom((obj, helpers) => {
    const toDate = (v) => (v instanceof Date ? v : new Date(v));
    // regOpenDate ≤ registrationDeadline ≤ startDate ≤ endDate (endDate đã min startDate ở trên)
    if (toDate(obj.registrationDeadline) < toDate(obj.regOpenDate)) {
      return helpers.message(
        `"${FIELD_LABELS.registrationDeadline}" không được trước "${FIELD_LABELS.regOpenDate}"`
      );
    }
    return obj;
  });

/* --------------------------------- UPDATE --------------------------------- */
const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).label(FIELD_LABELS.name),
  image: Joi.string().uri().allow("").label(FIELD_LABELS.image),
  sportType: Joi.number().valid(1, 2).label(FIELD_LABELS.sportType),
  groupId: Joi.number().integer().min(0).label(FIELD_LABELS.groupId),
  eventType: Joi.string()
    .valid("single", "double")
    .label(FIELD_LABELS.eventType),

  regOpenDate: dateISO.label(FIELD_LABELS.regOpenDate),
  registrationDeadline: dateISO.label(FIELD_LABELS.registrationDeadline),
  startDate: dateISO.label(FIELD_LABELS.startDate),
  endDate: dateISO.label(FIELD_LABELS.endDate), // kiểm tra chéo phía dưới (trong custom)

  scoreCap: Joi.number().min(0).label(FIELD_LABELS.scoreCap),
  scoreGap: Joi.number().min(0).label(FIELD_LABELS.scoreGap),
  singleCap: Joi.number().min(0).label(FIELD_LABELS.singleCap),
  maxPairs: Joi.number().integer().min(0).label(FIELD_LABELS.maxPairs),

  location: Joi.string().trim().min(2).label(FIELD_LABELS.location),
  contactHtml: Joi.string().allow("").label(FIELD_LABELS.contactHtml),
  contentHtml: Joi.string().allow("").label(FIELD_LABELS.contentHtml),
  noRankDelta: boolLoose.label("Không áp dụng điểm trình"),

  // NEW: phạm vi chấm đa tỉnh
  scoringScope: scoringScopeUpdate,

  // NEW: thanh toán
  bankShortName,
  bankAccountNumber,
  bankAccountName,
  registrationFee,
})
  .with("bankShortName", ["bankAccountNumber", "bankAccountName"])
  .with("bankAccountNumber", ["bankShortName", "bankAccountName"])
  .with("bankAccountName", ["bankShortName", "bankAccountNumber"])
  .messages(COMMON_MESSAGES)
  .custom((obj, helpers) => {
    const toDate = (v) => (v instanceof Date ? v : new Date(v));
    // Chỉ kiểm tra khi cả hai đầu mốc đều có trong payload
    if (obj.startDate && obj.endDate) {
      if (toDate(obj.endDate) < toDate(obj.startDate)) {
        return helpers.message(
          `"${FIELD_LABELS.endDate}" phải ≥ "${FIELD_LABELS.startDate}"`
        );
      }
    }
    if (obj.regOpenDate && obj.registrationDeadline) {
      if (toDate(obj.registrationDeadline) < toDate(obj.regOpenDate)) {
        return helpers.message(
          `"${FIELD_LABELS.registrationDeadline}" không được trước "${FIELD_LABELS.regOpenDate}"`
        );
      }
    }
    return obj;
  });

/* ------------------------------- Helpers ------------------------------ */
// ── validate: trả message cụ thể, kèm errors/fields/strippedKeys ─────────────
const validate = (schema, payload) => {
  const options = {
    convert: true,
    stripUnknown: { objects: true },
    abortEarly: false,
    errors: { wrap: { label: "" } }, // không bọc "" quanh label
  };

  const { error, value } = schema.validate(payload, options);

  // key top-level bị strip
  const strippedKeys = Object.keys(payload || {}).filter(
    (k) => !(k in (value || {}))
  );

  if (error) {
    // map chi tiết
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

    // gom theo field
    const fields = details.reduce((acc, e) => {
      acc[e.path] = acc[e.path] || [];
      acc[e.path].push(e.message);
      return acc;
    }, {});

    // 👉 message tổng hợp: gộp các thông điệp, ngăn cách bằng "; "
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
/*  Controllers (bọc expressAsyncHandler)                                     */
/* -------------------------------------------------------------------------- */

export const getTournaments = expressAsyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page ?? 1, 10), 1);
  const limit = Math.min(parseInt(req.query.limit ?? 50, 10), 100);

  // sort từ client, ví dụ: "-createdAt,name"
  const sortRaw = (req.query.sort || "-createdAt").toString();
  const sortSpecRaw = parseSort(sortRaw);
  const sortSpec = Object.keys(sortSpecRaw).length
    ? sortSpecRaw
    : { createdAt: -1, _id: -1 };

  const { keyword = "", status = "", sportType, groupId } = req.query;

  // Cho phép truyền tz nhưng LƯU Ý:
  // so sánh "instant" dùng startAt/endAt (đã là UTC từ TZ của doc), nên NOW (UTC) là đủ để so.
  // TZ vẫn giữ lại để dùng nơi khác nếu cần (vd: field hiển thị).
  const TZ =
    (typeof req.query.tz === "string" &&
      isValidTZ(req.query.tz) &&
      req.query.tz) ||
    "Asia/Ho_Chi_Minh";

  // Filter cơ bản
  const match = {};
  if (keyword.trim()) match.name = { $regex: keyword.trim(), $options: "i" };
  if (sportType) match.sportType = Number(sportType);
  if (groupId) match.groupId = Number(groupId);

  const skip = (page - 1) * limit;

  // Map alias status (VN/EN) → upcoming | ongoing | finished
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

  // ƯU TIÊN STATUS trước: ongoing (0) → upcoming (1) → finished (2)
  const sortFinal = { statusPriority: 1, ...sortSpec };

  const pipeline = [
    { $match: match },

    // Chuẩn hoá instant để so sánh (UTC):
    // - Ưu tiên *_At (đã chuẩn từ TZ doc).
    // - Fallback *_Date cho doc cũ.
    {
      $addFields: {
        _startInstant: { $ifNull: ["$startAt", "$startDate"] },
        _endInstant: { $ifNull: ["$endAt", "$endDate"] },
      },
    },

    // Tính status:
    // - Nếu có finishedAt => finished (ưu tiên tuyệt đối).
    // - Nếu NOW < start  => upcoming
    // - Nếu NOW > end    => finished
    // - Ngược lại        => ongoing
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

    // Ưu tiên sort theo status trước
    {
      $addFields: {
        statusPriority: {
          $switch: {
            branches: [
              { case: { $eq: ["$status", "ongoing"] }, then: 0 },
              { case: { $eq: ["$status", "upcoming"] }, then: 1 },
            ],
            default: 2, // finished
          },
        },
      },
    },

    // Nếu client yêu cầu status cụ thể, lọc sau khi đã tính status
    ...(wantedStatus ? [{ $match: { status: wantedStatus } }] : []),

    {
      $facet: {
        data: [
          { $sort: sortFinal },
          { $skip: skip },
          { $limit: limit },

          // Đếm số registration
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

          // Ẩn field phụ trợ
          {
            $project: {
              _rc: 0,
              _startInstant: 0,
              _endInstant: 0,
            },
          },
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

// CREATE Tournament
export const adminCreateTournament = expressAsyncHandler(async (req, res) => {
  // === PRE-SANITIZE scoringScope để tránh lỗi forbidden khi type = national
  const incoming = { ...(req.body || {}) };

  // --- scoringScope (giữ logic cũ) ---
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

  // --- NEW: PRE-SANITIZE payment fields (SePay VietQR compatible) ---
  if (Object.prototype.hasOwnProperty.call(incoming, "bankShortName")) {
    incoming.bankShortName = String(incoming.bankShortName || "").trim();
  }
  if (Object.prototype.hasOwnProperty.call(incoming, "bankAccountNumber")) {
    // chỉ giữ chữ số, giữ rỗng nếu không có
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
    // chấp nhận "500,000" hoặc "500000"; không âm; làm tròn xuống
    const raw = String(incoming.registrationFee ?? "").replace(/[^0-9.-]/g, "");
    const fee = Number(raw);
    incoming.registrationFee =
      Number.isFinite(fee) && fee >= 0 ? Math.floor(fee) : 0;
  }

  // Validate với createSchema (Joi sẽ set default nếu thiếu)
  const data = validate(createSchema, incoming);

  // sanitize HTML trước khi lưu
  data.contactHtml = cleanHTML(data.contactHtml);
  data.contentHtml = cleanHTML(data.contentHtml);
  if (data._meta) delete data._meta;

  if (!req.user?._id) {
    res.status(401);
    throw new Error("Unauthenticated");
  }

  // Tạo tournament (đồng bộ)
  const t = await Tournament.create({
    ...data,
    createdBy: req.user._id,
  });

  // ✅ Trả về ngay cho client
  res.status(201).json(t);

  // ---- Các tác vụ ngoài chạy nền (không await) ----

  // 1) Lên lịch thông báo (best effort)
  setImmediate(() => {
    scheduleTournamentCountdown(t).catch((e) => {
      console.error(
        "[adminCreateTournament] scheduleTournamentCountdown failed:",
        e?.message || e,
        { tournamentId: String(t._id) }
      );
    });
  });

  // 2) Tạo topic Telegram (best effort)
  setImmediate(async () => {
    try {
      const tele = t.tele || {};
      const teleEnabled = tele.enabled !== false;
      if (!teleEnabled) {
        console.log(
          "[adminCreateTournament] tele disabled; skip creating topic",
          {
            tournamentId: String(t._id),
          }
        );
        return;
      }

      const hubChatId = tele.hubChatId || process.env.TELEGRAM_HUB_CHAT_ID;
      if (!hubChatId) {
        console.error(
          "[adminCreateTournament] Missing TELEGRAM_HUB_CHAT_ID; skip creating topic",
          { tournamentId: String(t._id) }
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

// UPDATE Tournament (admin)
export const adminUpdateTournament = expressAsyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  // Clone & chuẩn hoá input
  const incoming = { ...(req.body || {}) };

  // === PRE-SANITIZE scoringScope (giữ logic cũ) ===
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

  // === NEW: PRE-SANITIZE payment fields ===
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

  // Validate (theo updateSchema)
  const payload = validate(updateSchema, incoming);
  if (!Object.keys(payload).length) {
    res.status(400);
    throw new Error("Không có dữ liệu để cập nhật");
  }

  // sanitize HTML
  if (typeof payload.contactHtml === "string") {
    payload.contactHtml = cleanHTML(payload.contactHtml);
  }
  if (typeof payload.contentHtml === "string") {
    payload.contentHtml = cleanHTML(payload.contentHtml);
  }
  if (payload._meta) delete payload._meta;

  // Update chính
  let t = await Tournament.findByIdAndUpdate(
    req.params.id,
    { $set: payload },
    { new: true, runValidators: true, context: "query" }
  );

  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  // === NEW: Auto-derive status theo thời gian ===
  // Dùng timezone của giải, so sánh bao gồm biên:
  // - now < start  => upcoming
  // - start <= now <= end => ongoing
  // - now > end   => finished (+ finishedAt = now)
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

    // Chỉ patch nếu khác hiện tại (tránh update thừa)
    if (
      nextStatus !== t.status ||
      (shouldSetFinishedAt && !t.finishedAt) ||
      (!shouldSetFinishedAt && t.finishedAt)
    ) {
      // Cập nhật vào DB và object trả về
      // (không đụng tới start/end, chỉ status & finishedAt)
      // Lưu ý: updateOne nhanh, không kích hoạt vòng recomputeUTC
      // vì không thay đổi mốc thời gian.
      // Nếu muốn bật hooks, có thể dùng findByIdAndUpdate.
      t.status = nextStatus;
      t.finishedAt = finishedAt;
      // đồng bộ DB (không await cũng được, nhưng để chắc chắn response nhất quán thì await)
      // nếu muốn tối ưu latency có thể bỏ await.
      // Ở đây mình giữ await để res.json phản ánh đúng.
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
      // ✅ Trả về ngay (đã có status mới trong `t` nếu có đổi)
      res.json(t);

      // ---- Tác vụ nền (không await) ----

      // 1) Lên lịch đếm ngược
      setImmediate(() => {
        scheduleTournamentCountdown(t).catch((e) => {
          console.error(
            "[adminUpdateTournament] scheduleTournamentCountdown failed:",
            e?.message || e,
            { tournamentId: String(t._id) }
          );
        });
      });

      // 2) Auto-create forum topic nếu cần
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
                { tournamentId: String(t._id), name: t.name }
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

/** Kết thúc 1 giải (snap endDate = hôm nay theo TZ, endAt = cuối ngày TZ) */
async function finalizeOneTournament(id) {
  const t0 = await Tournament.findById(id).select("_id status timezone").lean();
  if (!t0) return { ok: false, reason: "not_found" };
  if (t0.status === "finished")
    return { ok: false, reason: "already_finished" };

  const tz = isValidTZ(t0.timezone) ? t0.timezone : "Asia/Ho_Chi_Minh";
  const nowLocal = DateTime.now().setZone(tz);
  const nowUTC = nowLocal.toUTC();
  const endOfLocalDayUTC = nowLocal.endOf("day").toUTC();

  const t = await Tournament.findOneAndUpdate(
    { _id: id, status: { $ne: "finished" } },
    {
      $set: {
        status: "finished",
        finishedAt: nowUTC.toJSDate(),
        endDate: nowLocal.toJSDate(), // ngày địa phương hôm nay
        endAt: endOfLocalDayUTC.toJSDate(), // mốc UTC cuối ngày
      },
    },
    { new: true }
  );
  if (!t) return { ok: false, reason: "race_finished" };

  // gom userIds tham gia
  const regs = await Registration.find({ tournament: id })
    .select("player1 player2")
    .lean();
  const userIds = Array.from(
    new Set(
      regs.flatMap((r) => [r.player1, r.player2].filter(Boolean)).map(String)
    )
  );

  await addTournamentReputationBonus({ userIds, tournamentId: id, amount: 10 });

  return { ok: true, tournamentId: String(id), playerCount: userIds.length };
}

/** PUT /tournament/:id/finish */
export const finishTournament = expressAsyncHandler(async (req, res) => {
  const r = await finalizeOneTournament(req.params.id);
  if (!r.ok && r.reason === "not_found") {
    res.status(404);
    throw new Error("Tournament not found");
  }
  res.json(r);
});

/** POST /tournaments/finish-expired — quét endAt <= now & kết thúc hàng loạt */
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

  // quyền (tùy hệ thống của bạn)
  // if (req.user?.role !== "admin") { res.status(403); throw new Error("Forbidden"); }

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

/**
 * body:
 * {
 *   groups: { count, size, qualifiersPerGroup, totalTeams?, groupSizes?, rules? } | null,
 *   po: { drawSize, maxRounds?, seeds?, rules? } | null,
 *   ko: { drawSize, seeds: [{pair, A:{...}, B:{...}}], rules?, finalRules? } | null
 * }
 */
/* ---------- Helper: tự động cho đội gặp BYE đi tiếp ---------- */
const isByeSeed = (s) => {
  if (!s) return false;
  const t = String(s.type || "").toLowerCase();
  if (t === "bye") return true;
  // phòng trường hợp FE gửi label/name = "BYE"
  const lbl = (s.label || s.name || "").toString().toUpperCase();
  if (lbl === "BYE") return true;
  return false;
};

// chuẩn hoá 1 rule để chắc chắn có đủ field
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
  if (mode === "none") {
    points = null;
  } else {
    const n = Number(points);
    points = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
  }
  return {
    bestOf,
    pointsToWin,
    winByTwo,
    cap: { mode, points },
  };
}

// gán rule vào bản ghi Match để cả FE/BE cũ đọc được
function applyRuleToMatch(mDoc, ruleObj) {
  const r = normalizeRule(ruleObj);
  mDoc.rules = r;
  mDoc.bestOf = r.bestOf;
  mDoc.pointsToWin = r.pointsToWin;
  mDoc.winByTwo = r.winByTwo;
  mDoc.capMode = r.cap.mode;
  mDoc.capPoints = r.cap.points;
}

/**
 * Sau khi build bracket, tự động:
 *  - Kết thúc các trận có 1 bên BYE (winner = bên còn lại)
 *  - Gán seed thắng thẳng vào trận vòng sau, xóa previousA/previousB tương ứng
 *  - GÁN LUÔN RULE THEO VÒNG CHO CẢ TRẬN HIỆN TẠI & TRẬN VÒNG SAU
 */
async function autoAdvanceByesForBracket(bracketId, session) {
  if (!bracketId) return;

  // ⬅️ Lấy bracket để biết roundRules mà FE đã gửi
  const bracket = await Bracket.findById(bracketId).session(session);

  const baseRule = normalizeRule(bracket?.rules);
  const roundRules = Array.isArray(bracket?.config?.roundRules)
    ? bracket.config.roundRules.map((r) => normalizeRule(r))
    : [];

  const ruleForRound = (roundNum) => {
    const idx = Math.max(0, Number(roundNum || 1) - 1);
    return roundRules[idx] || baseRule;
  };

  // Lấy toàn bộ trận của bracket
  let matches = await Match.find({ bracket: bracketId }).session(session);

  const idOf = (x) => String(x?._id || x || "");

  // Build chỉ số "trận kế tiếp" theo previousA/B
  const nextMap = new Map(); // matchId -> [{match,nextSide:'A'|'B'}]
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

  // Lặp vài vòng để xử lý các trường hợp dồn BYE liên tiếp
  let changed = true;
  let pass = 0;
  while (changed && pass < 5) {
    changed = false;
    pass += 1;

    for (const m of matches) {
      const status = String(m.status || "").toLowerCase();
      const aBye = isByeSeed(m.seedA);
      const bBye = isByeSeed(m.seedB);

      // Chỉ xử lý khi đúng 1 bên là BYE
      if (aBye === bBye) continue;

      const winnerSide = aBye ? "B" : "A";
      const advSeed = aBye ? m.seedB : m.seedA; // seed đi tiếp
      const thisRound = Number(m.round || 1);

      // 1) Kết thúc trận nếu chưa kết thúc
      if (status !== "finished" || m.winner !== winnerSide) {
        m.status = "finished";
        m.winner = winnerSide;
        m.startedAt = m.startedAt || new Date();
        m.finishedAt = new Date();
        m.auto = true;
        m.autoReason = "bye";

        // ⬅️ gán đúng rule của vòng hiện tại (VD: V2 là BO3 thì ở đây sẽ được BO3)
        const curRule = ruleForRound(thisRound);
        applyRuleToMatch(m, curRule);

        await m.save({ session });
        changed = true;
      }

      // 2) Đẩy seed thắng vào vòng sau (nếu có trận kế tiếp)
      const followers = nextMap.get(idOf(m)) || [];
      for (const { match: nx, side } of followers) {
        const sideKeySeed = side === "A" ? "seedA" : "seedB";
        const sideKeyPrev = side === "A" ? "previousA" : "previousB";

        // Nếu side của trận sau vẫn đang phụ thuộc vào trận này → gán seed trực tiếp
        if (idOf(nx[sideKeyPrev]) === idOf(m)) {
          nx[sideKeySeed] = advSeed; // giữ nguyên object seed (registration/groupRank/…)
          nx[sideKeyPrev] = undefined; // bỏ phụ thuộc, hiển thị seed luôn

          // ⬅️ và gán rule cho TRẬN VÒNG SAU theo round của nó
          const nxRound = Number(nx.round || thisRound + 1);
          const nxRule = ruleForRound(nxRound);
          applyRuleToMatch(nx, nxRule);

          await nx.save({ session });
          changed = true;
        }
      }
    }

    // refresh mảng matches cho vòng sau (đề phòng DB đã thay đổi)
    if (changed) {
      matches = await Match.find({ bracket: bracketId }).session(session);
    }
  }
}

export const planCommit = expressAsyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const t = await Tournament.findById(id).session(session);
    if (!t) {
      res.status(404);
      throw new Error("Tournament not found");
    }

    const { groups, po, ko, force } = req.body || {};
    const created = { groupBracket: null, poBracket: null, koBracket: null };

    // chuẩn hoá rule có CAP
    const normalizeRule = (rules) => {
      if (!rules) return undefined;
      const base = {
        bestOf: Number(rules.bestOf ?? 1),
        pointsToWin: Number(rules.pointsToWin ?? 11),
        winByTwo: rules.winByTwo !== false,
      };
      const rawMode = String(rules?.cap?.mode ?? "none").toLowerCase();
      const mode = ["none", "soft", "hard"].includes(rawMode)
        ? rawMode
        : "none";
      let points = rules?.cap?.points;
      if (mode === "none") {
        points = null;
      } else {
        const n = Number(points);
        points = Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
      }
      return { ...base, cap: { mode, points } };
    };

    // chuẩn hoá mảng rule theo round cho PO
    const normalizeRoundRules = (arr, fallback, maxRounds) => {
      if (!Array.isArray(arr) || !arr.length) {
        // không gửi -> fill theo fallback
        return Array.from({ length: maxRounds }, () => normalizeRule(fallback));
      }
      const out = arr.map((r) => normalizeRule(r || fallback));
      // nếu FE gửi thiếu round -> fill thêm
      while (out.length < maxRounds) {
        out.push(normalizeRule(fallback));
      }
      // nếu gửi thừa -> cắt bớt
      return out.slice(0, maxRounds);
    };

    const hasGroup = Boolean(Number(groups?.count) > 0);
    const hasPO = Boolean(Number(po?.drawSize) > 0);
    const hasKO = Boolean(Number(ko?.drawSize) > 0);

    if (!hasGroup && !hasPO && !hasKO) {
      res.status(400);
      throw new Error("Nothing to create from plan");
    }

    // nếu FE cho phép ghi đè → xoá toàn bộ bracket cũ của giải này
    if (force === true) {
      try {
        await Bracket.deleteMany({ tournament: t._id }).session(session);
      } catch (err) {
        // không xoá được cũng không làm hỏng transaction chính
      }
    }

    let orderCounter = 1;
    const groupOrder = hasGroup ? orderCounter++ : null;
    const poOrder = hasPO ? orderCounter++ : null;
    const koOrder = hasKO ? orderCounter++ : null;

    // ===== GROUP =====
    if (hasGroup) {
      const payload = {
        tournamentId: t._id,
        name: "Group Stage",
        order: groupOrder,
        stage: groupOrder,
        groupCount: Number(groups.count),
        // nếu FE gửi totalTeams thì bỏ groupSize để builder tự chia
        groupSize:
          Number(groups.totalTeams || 0) > 0
            ? undefined
            : Number(groups.size || 0) || undefined,
        totalTeams: Number(groups.totalTeams || 0) || undefined,
        groupSizes: Array.isArray(groups.groupSizes)
          ? groups.groupSizes
          : undefined,
        // ✅ FE có gửi groups.qualifiersPerGroup
        qualifiersPerGroup: Number(groups.qualifiersPerGroup || 1),
        rules: normalizeRule(groups?.rules),
        session,
      };
      created.groupBracket = await buildGroupBracket(payload);
    }

    // ===== PO =====
    if (hasPO) {
      const drawSize = Number(po.drawSize);
      const maxRounds = Math.max(1, Number(po.maxRounds || 1));
      const firstRoundSeeds = Array.isArray(po.seeds) ? po.seeds : [];

      // ✅ chuẩn hoá rule tổng và từng round
      const poRules = normalizeRule(po?.rules);
      const poRoundRules = normalizeRoundRules(
        po?.roundRules,
        po?.rules,
        maxRounds
      );

      const { bracket } = await buildRoundElimBracket({
        tournamentId: t._id,
        name: po?.name || "Pre-Qualifying",
        order: poOrder,
        stage: poOrder,
        drawSize,
        maxRounds,
        firstRoundSeeds,
        rules: poRules,
        // ✅ truyền xuống BE để lưu cạnh bracket (builder tuỳ bạn xử lý)
        roundRules: poRoundRules,
        session,
      });
      created.poBracket = bracket;

      // tự động đẩy BYE
      await autoAdvanceByesForBracket(bracket._id, session);
    }

    // ===== KO =====
    if (hasKO) {
      const drawSize = Number(ko.drawSize);
      const firstRoundSeeds = Array.isArray(ko.seeds) ? ko.seeds : [];

      const koRules = normalizeRule(ko?.rules);
      const koFinalRules = ko?.finalRules ? normalizeRule(ko.finalRules) : null;

      const { bracket } = await buildKnockoutBracket({
        tournamentId: t._id,
        name: ko?.name || "Knockout",
        order: koOrder,
        stage: koOrder,
        drawSize,
        firstRoundSeeds,
        rules: koRules,
        finalRules: koFinalRules,
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
  // chỉ cho phép set các key whitelist
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

/**
 * GET /admin/tournaments/:id/referees?q=&limit=100
 * Trả về danh sách user có role='referee' và có trong referee.tournaments của giải.
 */
export const listTournamentRefereesInScope = expressAsyncHandler(
  async (req, res) => {
    const { id } = req.params;
    const me = req.user;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }

    // Quyền
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, id);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Query params
    const qRaw = String(req.query?.q || "").trim();
    const limit = Math.min(
      Math.max(parseInt(req.query?.limit, 10) || 50, 1),
      200
    );

    // Điều kiện tìm kiếm
    const orQ = [];
    if (qRaw) {
      // escape regex
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
      // giúp sort/so khớp tiếng Việt dễ chịu hơn (nếu MongoDB bật collation vi)
      .collation({ locale: "vi", strength: 1 })
      .lean();

    res.json({ items });
  }
);

/**
 * POST /api/admin/tournaments/:tid/referees
 * Body:
 *  - { set: string[] }                // REPLACE toàn bộ danh sách
 *    hoặc
 *  - { add: string[], remove: string[] } // PATCH cộng/trừ
 *
 * Trả về danh sách trọng tài của giải sau khi cập nhật.
 */

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

    // Nếu là chế độ REPLACE, tính toAdd/toRemove so với current
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

      // add tournament id vào referee.tournaments
      if (toAdd.length) {
        await User.updateMany(
          { _id: { $in: toAdd } },
          { $addToSet: { "referee.tournaments": TID } }
        );
        // promote thành role=referee nếu đang là user (không đụng admin)
        await User.updateMany(
          { _id: { $in: toAdd }, role: { $nin: ["admin", "referee"] } },
          { $set: { role: "referee" } }
        );
      }
      // pull tournament id khỏi referee.tournaments
      if (toRemove.length) {
        await User.updateMany(
          { _id: { $in: toRemove } },
          { $pull: { "referee.tournaments": TID } }
        );
      }
    } else {
      // PATCH: add / remove
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

    // (Optional) Hạ cấp role nếu ref.tournaments rỗng:
    // await User.updateMany(
    //   { role: "referee", "referee.tournaments": { $size: 0 } },
    //   { $set: { role: "user" } }
    // );

    // Trả về danh sách sau cập nhật
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
