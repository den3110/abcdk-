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
  noRankDelta: boolLoose.default(false).label("Không áp dụng điểm trình"), // <-- thêm

  // NEW: phạm vi chấm đa tỉnh
  scoringScope: scoringScopeCreate,
})
  .messages(COMMON_MESSAGES)
  .custom((obj, helpers) => {
    const toDate = (v) => (v instanceof Date ? v : new Date(v));
    // regOpenDate ≤ registrationDeadline ≤ startDate ≤ endDate (endDate đã min startDate ở trên)
    if (toDate(obj.registrationDeadline) < toDate(obj.regOpenDate)) {
      return helpers.message(
        `"${FIELD_LABELS.registrationDeadline}" không được trước "${FIELD_LABELS.regOpenDate}"`
      );
    }
    // if (toDate(obj.registrationDeadline) > toDate(obj.startDate)) {
    //   return helpers.message(
    //     `"${FIELD_LABELS.registrationDeadline}" không được sau "${FIELD_LABELS.startDate}"`
    //   );
    // }
    return obj;
  });

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
  noRankDelta: boolLoose.label("Không áp dụng điểm trình"), // <-- thêm

  // NEW: phạm vi chấm đa tỉnh
  scoringScope: scoringScopeUpdate,
})
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
    // if (obj.registrationDeadline && obj.startDate) {
    //   if (toDate(obj.registrationDeadline) > toDate(obj.startDate)) {
    //     return helpers.message(
    //       `"${FIELD_LABELS.registrationDeadline}" không được sau "${FIELD_LABELS.startDate}"`
    //     );
    //   }
    // }
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
  const sortRaw = (req.query.sort || "-createdAt").toString();
  const sortSpecRaw = parseSort(sortRaw);
  const sortSpec = Object.keys(sortSpecRaw).length
    ? sortSpecRaw
    : { createdAt: -1, _id: -1 };

  const { keyword = "", status = "", sportType, groupId } = req.query;

  // Cho phép truyền tz từ client: ?tz=Asia/Ho_Chi_Minh (fallback VN)
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

  // Chuẩn hoá status theo ngôn ngữ
  const statusNorm = String(status || "").toLowerCase();
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
  const wantedStatus = mapStatus[statusNorm] || null;

  const pipeline = [
    { $match: match },
    // Tính status theo ngày local TZ (bao gồm ngày bắt & kết thúc)
    {
      $addFields: {
        _nowDay: {
          $dateToString: { date: "$$NOW", format: "%Y-%m-%d", timezone: TZ },
        },
        _startDay: {
          $dateToString: {
            date: "$startDate",
            format: "%Y-%m-%d",
            timezone: TZ,
          },
        },
        _endDay: {
          $dateToString: { date: "$endDate", format: "%Y-%m-%d", timezone: TZ },
        },
      },
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $lt: ["$_nowDay", "$_startDay"] }, then: "upcoming" },
              { case: { $gt: ["$_nowDay", "$_endDay"] }, then: "finished" },
            ],
            default: "ongoing",
          },
        },
      },
    },
  ];

  if (wantedStatus) pipeline.push({ $match: { status: wantedStatus } });

  pipeline.push({
    $facet: {
      data: [
        { $sort: sortSpec },
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
        { $project: { _rc: 0, _nowDay: 0, _startDay: 0, _endDay: 0 } },
      ],
      total: [{ $count: "count" }],
    },
  });

  const agg = await Tournament.aggregate(pipeline);
  const list = agg?.[0]?.data || [];
  const total = agg?.[0]?.total?.[0]?.count || 0;

  res.json({ total, page, limit, list });
});

// CREATE Tournament
export const adminCreateTournament = expressAsyncHandler(async (req, res) => {
  const data = validate(createSchema, req.body);

  // sanitize HTML trước khi lưu
  data.contactHtml = cleanHTML(data.contactHtml);
  data.contentHtml = cleanHTML(data.contentHtml);

  if (data._meta) delete data._meta;

  if (!req.user?._id) {
    res.status(401);
    throw new Error("Unauthenticated");
  }

  // Joi đã set noRankDelta (mặc định false nếu không gửi)
  const t = await Tournament.create({
    ...data,
    createdBy: req.user._id,
  });

  try {
    await scheduleTournamentCountdown(t);
  } catch (e) {
    console.log(e);
  }

  res.status(201).json(t);
});

// UPDATE Tournament (admin)
export const adminUpdateTournament = expressAsyncHandler(async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400);
    throw new Error("Invalid ID");
  }

  const payload = validate(updateSchema, req.body);
  if (!Object.keys(payload).length) {
    res.status(400);
    throw new Error("Không có dữ liệu để cập nhật");
  }

  // sanitize HTML nếu có cập nhật
  if (typeof payload.contactHtml === "string") {
    payload.contactHtml = cleanHTML(payload.contactHtml);
  }
  if (typeof payload.contentHtml === "string") {
    payload.contentHtml = cleanHTML(payload.contentHtml);
  }
  if (payload._meta) delete payload._meta;

  // payload.noRankDelta lúc này đã là boolean chuẩn nhờ Joi (nếu client gửi)
  const t = await Tournament.findByIdAndUpdate(
    req.params.id,
    { $set: payload },
    { new: true, runValidators: false }
  );

  try {
    await scheduleTournamentCountdown(t);
  } catch (e) {
    console.log(e);
  }

  if (!t) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  // Bật ở giải → tự bật toàn bộ bracket trong giải (tắt thì không động tới bracket)
  if (
    Object.prototype.hasOwnProperty.call(payload, "noRankDelta") &&
    payload.noRankDelta === true
  ) {
    try {
      await Bracket.updateMany(
        { tournament: t._id },
        { $set: { noRankDelta: true } }
      );
    } catch (e) {
      console.log("Failed to cascade noRankDelta to brackets:", e);
    }
  }

  res.json(t);
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

    const { groups, po, ko } = req.body || {};
    const created = { groupBracket: null, poBracket: null, koBracket: null };

    // ===== ONLY ADD: chuẩn hoá cap trong rules (không đổi các field khác)
    const withCap = (rules) => {
      if (!rules) return undefined;
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
      return { ...rules, cap: { mode, points } };
    };
    // ===== END ONLY ADD

    // Xác định stage nào thực sự có
    const hasGroup = Boolean(groups?.count > 0);
    const hasPO = Boolean(po?.drawSize > 0);
    const hasKO = Boolean(ko?.drawSize > 0);

    // Gán order liên tiếp từ 1 theo các stage có mặt
    let orderCounter = 1;
    const groupOrder = hasGroup ? orderCounter++ : null;
    const poOrder = hasPO ? orderCounter++ : null;
    const koOrder = hasKO ? orderCounter++ : null;

    // 1) Group (hỗ trợ totalTeams / groupSizes) — NGUYÊN LOGIC CŨ
    if (hasGroup) {
      const payload = {
        tournamentId: t._id,
        name: "Group Stage",
        order: groupOrder,
        stage: groupOrder,
        groupCount: Number(groups.count),
        groupSize: Number(groups.size || 0) || undefined,
        totalTeams: Number(groups.totalTeams || 0) || undefined,
        groupSizes: Array.isArray(groups.groupSizes)
          ? groups.groupSizes
          : undefined,
        rules: withCap(groups?.rules), // <— chỉ thêm chuẩn hoá cap
        session,
      };
      created.groupBracket = await buildGroupBracket(payload);
    }

    // 2) PO (roundElim – KHÔNG ép 2^n) — NGUYÊN LOGIC CŨ
    if (hasPO) {
      const firstRoundSeeds = Array.isArray(po.seeds) ? po.seeds : [];
      const { bracket } = await buildRoundElimBracket({
        tournamentId: t._id,
        name: "Pre-Qualifying",
        order: poOrder,
        stage: poOrder,
        drawSize: Number(po.drawSize),
        maxRounds: Math.max(1, Number(po.maxRounds || 1)),
        firstRoundSeeds,
        rules: withCap(po?.rules), // <— chỉ thêm chuẩn hoá cap
        session,
      });
      created.poBracket = bracket;
    }

    // 3) KO chính — NGUYÊN LOGIC CŨ
    if (hasKO) {
      const firstRoundSeeds = Array.isArray(ko.seeds) ? ko.seeds : [];
      const { bracket } = await buildKnockoutBracket({
        tournamentId: t._id,
        name: "Knockout",
        order: koOrder,
        stage: koOrder,
        drawSize: Number(ko.drawSize),
        firstRoundSeeds,
        rules: withCap(ko?.rules), // <— chỉ thêm chuẩn hoá cap
        finalRules: ko?.finalRules ? withCap(ko.finalRules) : null, // <— chỉ thêm chuẩn hoá cap
        session,
      });
      created.koBracket = bracket;
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
