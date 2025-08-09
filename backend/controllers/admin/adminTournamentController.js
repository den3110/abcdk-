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
    const page = Math.max(+req.query.page || 1, 1);
    const limit = Math.min(+req.query.limit || 50, 100);
    const sort = req.query.sort || "-createdAt";

    const { keyword = "", status = "", sportType, groupId } = req.query;

    const filter = {};
    if (keyword.trim()) filter.name = { $regex: keyword.trim(), $options: "i" };
    if (status) filter.status = status;
    if (sportType) filter.sportType = Number(sportType);
    if (groupId) filter.groupId = Number(groupId);

    const [list, total] = await Promise.all([
      Tournament.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit),
      Tournament.countDocuments(filter),
    ]);

    res.json({ total, page, limit, list });
  } catch (err) {
    next(err);
  }
};

export const createTournament = async (req, res, next) => {
  try {
    const body = validate(createSchema, req.body);
    const t = await Tournament.create(body);
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

    // Nếu payload rỗng không có gì để update
    if (!Object.keys(payload).length) {
      return res.status(400).json({ message: "Không có dữ liệu để cập nhật" });
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
