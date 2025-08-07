import Tournament from "../../models/tournamentModel.js";
import mongoose from "mongoose";
import Joi from "joi";

/* -------------------------------------------------------------------------- */
/*  1. Joi schemas                                                            */
/* -------------------------------------------------------------------------- */

const dateISO = Joi.date().iso();

const baseSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  image: Joi.string().uri().allow(""),
  sportType: Joi.number().valid(1, 2).required(), // 1 = Pickle, 2 = Tennis
  groupId: Joi.number().integer().min(0).default(0),
  eventType: Joi.string().valid("single", "double").default("double"),

  regOpenDate: dateISO.required(),
  registrationDeadline: dateISO.required(),
  startDate: dateISO.required(),
  endDate: dateISO.required(),

  scoreCap: Joi.number().min(0).default(0),
  scoreGap: Joi.number().min(0).default(0),
  singleCap: Joi.number().min(0).default(0),

  location: Joi.string().trim().min(2).required(),
  contactHtml: Joi.string().allow(""),
  contentHtml: Joi.string().allow(""),
}).custom((obj, helpers) => {
  // logic: regOpen ≤ deadline ≤ start ≤ end
  if (
    obj.regOpenDate > obj.registrationDeadline ||
    obj.registrationDeadline > obj.startDate ||
    obj.startDate > obj.endDate
  ) {
    return helpers.error("any.invalid");
  }
  return obj;
}, "date order validation");

const createSchema = baseSchema;
const updateSchema = baseSchema.fork(
  [
    "name",
    "sportType",
    "regOpenDate",
    "registrationDeadline",
    "startDate",
    "endDate",
    "location",
  ],
  (s) => s.optional() // make everything optional for PATCH/PUT
);

/* -------------------------------------------------------------------------- */
/*  2. Helpers                                                                */
/* -------------------------------------------------------------------------- */

const validate = (schema, payload) => {
  const { error, value } = schema.validate(payload, {
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

/* -------------------------------------------------------------------------- */
/*  3. Controllers                                                             */
/* -------------------------------------------------------------------------- */


export const getTournaments = async (req, res, next) => {
  try {
    /* ----------- pagination & sort ----------- */
    const page  = Math.max(+req.query.page  || 1, 1);
    const limit = Math.min(+req.query.limit || 50, 100);
    const sort  = req.query.sort || "-createdAt";

    /* ----------- filters ----------- */
    const {
      keyword  = "",          // tìm theo tên
      status   = "",          // upcoming | ongoing | finished
      sportType,              // 1 | 2
      groupId,                // số nguyên
    } = req.query;

    const filter = {};

    if (keyword.trim())
      filter.name = { $regex: keyword.trim(), $options: "i" };

    if (status)     filter.status    = status;          // ✅ thêm lọc status
    if (sportType)  filter.sportType = Number(sportType);
    if (groupId)    filter.groupId   = Number(groupId);

    /* ----------- DB query ----------- */
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

    // fall-back ngày hôm nay nếu FE bỏ trống (đã default trong schema)
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

    const payload = validate(updateSchema, req.body);

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
