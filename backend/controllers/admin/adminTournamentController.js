// controllers/tournamentController.js (hoặc nơi bạn đang để file này)
import Tournament from "../../models/tournamentModel.js";
import mongoose from "mongoose";
import Joi from "joi";

/* -------------------------- Schemas nới lỏng -------------------------- */

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
  // CHỈ giữ ràng buộc tối thiểu: end >= start
  endDate: dateISO.min(Joi.ref("startDate")).required(),

  scoreCap: Joi.number().min(0).default(0),
  scoreGap: Joi.number().min(0).default(0),
  singleCap: Joi.number().min(0).default(0),
  maxPairs: Joi.number().integer().min(0).default(0), // <-- NEW

  location: Joi.string().trim().min(2).required(),
  contactHtml: Joi.string().allow(""),
  contentHtml: Joi.string().allow(""),
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
  endDate: dateISO, // không ràng buộc chéo

  scoreCap: Joi.number().min(0),
  scoreGap: Joi.number().min(0),
  singleCap: Joi.number().min(0),
  maxPairs: Joi.number().integer().min(0), // <-- NEW

  location: Joi.string().trim().min(2),
  contactHtml: Joi.string().allow(""),
  contentHtml: Joi.string().allow(""),
});

/* --------------------------------------------------------------------- */

const validate = (schema, payload) => {
  const { error, value } = schema.validate(payload, {
    convert: true, // nhận 'YYYY-MM-DD'
    stripUnknown: true, // loại field thừa
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

/* -------------------------------------------------------------------------- */
/*  3. Controllers                                                            */
/* -------------------------------------------------------------------------- */

export const getTournaments = async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page ?? 1, 10), 1);
    const limit = Math.min(parseInt(req.query.limit ?? 50, 10), 100);
    const sort = (req.query.sort || "-createdAt").toString();

    const { keyword = "", status = "", sportType, groupId } = req.query;

    // Filter cơ bản (KHÔNG dùng status ở model)
    const match = {};
    if (keyword.trim()) match.name = { $regex: keyword.trim(), $options: "i" };
    if (sportType) match.sportType = Number(sportType);
    if (groupId) match.groupId = Number(groupId);

    // parse sort: "-createdAt,name" -> { createdAt: -1, name: 1 }
    const parseSort = (s) =>
      s.split(",").reduce((acc, token) => {
        const key = token.trim();
        if (!key) return acc;
        if (key.startsWith("-")) acc[key.slice(1)] = -1;
        else acc[key] = 1;
        return acc;
      }, {});
    const sortSpec = Object.keys(parseSort(sort)).length
      ? parseSort(sort)
      : { createdAt: -1, _id: -1 };

    const skip = (page - 1) * limit;
    const TZ = "Asia/Bangkok";

    // Chuẩn hoá tham số status (dùng status theo thời gian)
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

      // Tính status theo NGÀY (bao gồm cả ngày bắt đầu/kết thúc) theo TZ
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

    // Lọc theo status mới nếu có
    if (wantedStatus) {
      pipeline.push({ $match: { status: wantedStatus } });
    }

    // Facet: data (sort/skip/limit + lookup registered) & total
    pipeline.push({
      $facet: {
        data: [
          { $sort: sortSpec },
          { $skip: skip },
          { $limit: limit },

          // Đếm số registration thật
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
    if (!req.user?._id)
      return res.status(401).json({ message: "Unauthenticated" });
    const t = await Tournament.create({
      ...data,
      createdBy: req.user._id, // gán từ user đăng nhập
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

    // Validate phần payload gửi lên (optional + check thứ tự ngày nếu có)
    const payload = validate(updateSchema, req.body);

    if (!Object.keys(payload).length) {
      return res.status(400).json({ message: "Không có dữ liệu để cập nhật" });
    }

    // Check thứ tự ngày nếu cả 2 mốc đều có trong payload
    const toDate = (v) => (v instanceof Date ? v : new Date(v));
    if (payload.startDate && payload.endDate) {
      if (toDate(payload.endDate) < toDate(payload.startDate)) {
        return res.status(400).json({ message: "endDate phải ≥ startDate" });
      }
    }
    if (payload.regOpenDate && payload.registrationDeadline) {
      if (toDate(payload.registrationDeadline) < toDate(payload.regOpenDate)) {
        return res
          .status(400)
          .json({ message: "registrationDeadline phải ≥ regOpenDate" });
      }
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
