// controllers/tournamentController.js
import mongoose from "mongoose";
import Joi from "joi";
import sanitizeHtml from "sanitize-html";
import { DateTime } from "luxon";

import Tournament from "../../models/tournamentModel.js";
import Registration from "../../models/registrationModel.js";
import { addTournamentReputationBonus } from "../../services/reputationService.js";
import { autoPlan } from "../../services/tournamentPlanner.js";
import {
  buildGroupBracket,
  buildKnockoutBracket,
  buildRoundElimBracket,
} from "../../services/bracketBuilder.js";

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

/* ------------------------------ Joi schemas --------------------------- */
const dateISO = Joi.date().iso();

const createSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  image: Joi.string().uri().allow(""),
  sportType: Joi.number().valid(1, 2).required(),
  groupId: Joi.number().integer().min(0).default(0),
  eventType: Joi.string().valid("single", "double").default("double"),

  regOpenDate: dateISO.required(),
  registrationDeadline: dateISO.required(),
  startDate: dateISO.required(),
  // end >= start
  endDate: dateISO.min(Joi.ref("startDate")).required(),

  scoreCap: Joi.number().min(0).default(0),
  scoreGap: Joi.number().min(0).default(0),
  singleCap: Joi.number().min(0).default(0),
  maxPairs: Joi.number().integer().min(0).default(0),

  location: Joi.string().trim().min(2).required(),
  contactHtml: Joi.string().allow("").max(20_000).default(""),
  contentHtml: Joi.string().allow("").max(100_000).default(""),
}).messages({
  "date.min": "{{#label}} phải ≥ {{#limit.key}}",
});

const updateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120),
  image: Joi.string().uri().allow(""),
  sportType: Joi.number().valid(1, 2),
  groupId: Joi.number().integer().min(0),
  eventType: Joi.string().valid("single", "double"),

  regOpenDate: dateISO,
  registrationDeadline: dateISO,
  startDate: dateISO,
  endDate: dateISO, // kiểm tra chéo phía dưới

  scoreCap: Joi.number().min(0),
  scoreGap: Joi.number().min(0),
  singleCap: Joi.number().min(0),
  maxPairs: Joi.number().integer().min(0),

  location: Joi.string().trim().min(2),
  contactHtml: Joi.string().allow(""),
  contentHtml: Joi.string().allow(""),
});

/* ------------------------------- Helpers ------------------------------ */
const validate = (schema, payload) => {
  const { error, value } = schema.validate(payload, {
    convert: true, // nhận 'YYYY-MM-DD'
    stripUnknown: true,
    abortEarly: false,
  });
  if (error) {
    const err = new Error("Validation error");
    err.status = 400;
    err.details = error.details.map((d) => d.message);
    throw err;
  }
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
/*  Controllers                                                               */
/* -------------------------------------------------------------------------- */

export const getTournaments = async (req, res, next) => {
  try {
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
            $dateToString: {
              date: "$endDate",
              format: "%Y-%m-%d",
              timezone: TZ,
            },
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
  } catch (err) {
    next(err);
  }
};

export const createTournament = async (req, res, next) => {
  try {
    const data = validate(createSchema, req.body);

    // sanitize HTML trước khi lưu
    data.contactHtml = cleanHTML(data.contactHtml);
    data.contentHtml = cleanHTML(data.contentHtml);

    if (!req.user?._id)
      return res.status(401).json({ message: "Unauthenticated" });

    const t = await Tournament.create({
      ...data,
      createdBy: req.user._id,
    });
    res.status(201).json(t);
  } catch (err) {
    next(err);
  }
};

export const getTournamentById = async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const t = await Tournament.findById(req.params.id);
    if (!t) return res.status(404).json({ message: "Tournament not found" });
    res.json(t);
  } catch (err) {
    next(err);
  }
};

export const updateTournament = async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const payload = validate(updateSchema, req.body);
    if (!Object.keys(payload).length) {
      return res.status(400).json({ message: "Không có dữ liệu để cập nhật" });
    }

    // kiểm tra chéo ngày khi có cả 2 đầu mốc
    const toDate = (v) => (v instanceof Date ? v : new Date(v));
    if (payload.startDate && payload.endDate) {
      if (toDate(payload.endDate) < toDate(payload.startDate)) {
        return res.status(400).json({ message: "endDate phải ≥ startDate" });
      }
    }
    if (payload.regOpenDate && payload.registrationDeadline) {
      if (toDate(payload.registrationDeadline) < toDate(payload.regOpenDate)) {
        return res.status(400).json({
          message: "registrationDeadline phải ≥ regOpenDate",
        });
      }
    }
    // (khuyên) đảm bảo hạn đăng ký không sau ngày bắt đầu, nếu có cả 2
    if (payload.registrationDeadline && payload.startDate) {
      if (toDate(payload.registrationDeadline) > toDate(payload.startDate)) {
        return res.status(400).json({
          message: "registrationDeadline không được sau startDate",
        });
      }
    }

    // sanitize HTML nếu có cập nhật
    if (typeof payload.contactHtml === "string") {
      payload.contactHtml = cleanHTML(payload.contactHtml);
    }
    if (typeof payload.contentHtml === "string") {
      payload.contentHtml = cleanHTML(payload.contentHtml);
    }

    const t = await Tournament.findByIdAndUpdate(
      req.params.id,
      { $set: payload },
      { new: true, runValidators: false }
    );

    if (!t) return res.status(404).json({ message: "Tournament not found" });
    res.json(t);
  } catch (err) {
    next(err);
  }
};

export const deleteTournament = async (req, res, next) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const t = await Tournament.findByIdAndDelete(req.params.id);
    if (!t) return res.status(404).json({ message: "Tournament not found" });
    res.json({ message: "Tournament removed" });
  } catch (err) {
    next(err);
  }
};

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
export async function finishTournament(req, res) {
  try {
    const r = await finalizeOneTournament(req.params.id);
    if (!r.ok && r.reason === "not_found")
      return res.status(404).json({ message: "Tournament not found" });
    return res.json(r);
  } catch (e) {
    return res.status(500).json({ message: e.message || "Finish failed" });
  }
}

/** POST /tournaments/finish-expired — quét endAt <= now & kết thúc hàng loạt */
export async function finishExpiredTournaments(_req, res) {
  try {
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
    return res.json({ checked: ids.length, finished });
  } catch (e) {
    return res.status(500).json({ message: e.message || "Bulk finish failed" });
  }
}

export async function planAuto(req, res) {
  try {
    const { id } = req.params;
    const t = await Tournament.findById(id).lean();
    if (!t) return res.status(404).json({ message: "Tournament not found" });

    // quyền (tùy hệ thống của bạn)
    // if (req.user?.role !== "admin") return res.status(403).json({ message: "Forbidden" });

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

    return res.json(plan);
  } catch (e) {
    console.error("[planAuto] error:", e);
    res
      .status(500)
      .json({ message: "Auto plan failed", error: String(e?.message || e) });
  }
}

/**
 * body:
 * {
 *   groups: { count, size, qualifiersPerGroup } | null,
 *   po: { drawSize, seeds? } | null,
 *   ko: { drawSize, seeds: [{pair, A:{...}, B:{...}}] } | null
 * }
 */
export async function planCommit(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const t = await Tournament.findById(id).session(session);
    if (!t) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Tournament not found" });
    }

    const { groups, po, ko } = req.body || {};
    const created = { groupBracket: null, poBracket: null, koBracket: null };

    // Tính stage index liên tiếp
    let stageCounter = 1;
    let groupStageIdx = null;
    let poStageIdx = null;
    let koStageIdx = null;

    if (groups && groups.count > 0) {
      groupStageIdx = stageCounter++;
    }
    if (po && po.drawSize > 0) {
      poStageIdx = stageCounter++;
    }
    if (ko && ko.drawSize > 0) {
      koStageIdx = stageCounter++;
    }

    // 1) Group (hỗ trợ totalTeams / groupSizes)
    if (groups?.count > 0) {
      const payload = {
        tournamentId: t._id,
        name: "Group Stage",
        order: 1,
        stage: groupStageIdx || 1,
        groupCount: Number(groups.count),
        groupSize: Number(groups.size || 0) || undefined,
        totalTeams: Number(groups.totalTeams || 0) || undefined,
        groupSizes: Array.isArray(groups.groupSizes)
          ? groups.groupSizes
          : undefined,
        session,
      };
      created.groupBracket = await buildGroupBracket(payload);
    }

    // 2) PO (roundElim – KHÔNG ép 2^n)
    if (po?.drawSize > 0) {
      const firstRoundSeeds = Array.isArray(po.seeds) ? po.seeds : [];
      const { bracket } = await buildRoundElimBracket({
        tournamentId: t._id,
        name: "Pre-Qualifying",
        order: 2,
        stage: poStageIdx || (groupStageIdx ? groupStageIdx + 1 : 1),
        drawSize: Number(po.drawSize),
        maxRounds: Math.max(1, Number(po.maxRounds || 1)),
        firstRoundSeeds,
        session,
      });
      created.poBracket = bracket;
    }

    // 3) KO chính
    if (ko?.drawSize > 0) {
      const firstRoundSeeds = Array.isArray(ko.seeds) ? ko.seeds : [];
      const { bracket } = await buildKnockoutBracket({
        tournamentId: t._id,
        name: "Knockout",
        order: 3,
        stage:
          koStageIdx ||
          (poStageIdx ? poStageIdx + 1 : groupStageIdx ? groupStageIdx + 1 : 1),
        drawSize: Number(ko.drawSize),
        firstRoundSeeds,
        session,
      });
      created.koBracket = bracket;
    }

    await session.commitTransaction();
    session.endSession();

    return res.json({
      ok: true,
      created: {
        groupBracketId: created.groupBracket?._id || null,
        poBracketId: created.poBracket?._id || null,
        koBracketId: created.koBracket?._id || null,
      },
    });
  } catch (e) {
    console.error("[planCommit] error:", e);
    await session.abortTransaction();
    session.endSession();
    res
      .status(500)
      .json({ message: "Commit plan failed", error: String(e?.message || e) });
  }
}
