// controllers/adminEvaluatorController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../../models/userModel.js";

const PAGE_SIZE_DEFAULT = 10;
const ALLOWED_SPORTS = ["pickleball", "tennis"];

const isEmail = (s = "") =>
  /^[^\s@]+@[^\s@]+\\.[^\s@]+$/.test(String(s).toLowerCase());
const uniqTrim = (arr) =>
  Array.from(
    new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean))
  );

export const listEvaluators = asyncHandler(async (req, res) => {
  const pageSize = Math.max(
    1,
    Math.min(100, parseInt(req.query.pageSize ?? PAGE_SIZE_DEFAULT, 10))
  );
  const page = Math.max(1, parseInt(req.query.page ?? 1, 10));
  const keyword = String(req.query.keyword ?? "").trim();
  const province = String(req.query.province ?? "").trim();
  const sport = String(req.query.sport ?? "").trim();

  const filter = { "evaluator.enabled": true };
  if (keyword) {
    const rx = new RegExp(
      keyword.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&"),
      "i"
    );
    filter.$or = [{ name: rx }, { email: rx }, { nickname: rx }];
  }
  if (province) filter["evaluator.gradingScopes.provinces"] = province;
  if (sport) filter["evaluator.gradingScopes.sports"] = sport;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select(
        "_id name email phone nickname province evaluator updatedAt createdAt role"
      )
      .sort({ updatedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean()
      .collation({ locale: "vi", strength: 1 }),
    User.countDocuments(filter),
  ]);

  // Flatten gradingScopes cho FE
  const mapped = users.map((u) => ({
    ...u,
    gradingScopes: u.evaluator?.gradingScopes || { provinces: [], sports: [] },
  }));

  res.json({ users: mapped, total, pageSize, page });
});

export const updateEvaluatorScopes = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const user = await User.findById(id);
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  const provinces = uniqTrim(req.body?.provinces || []);
  const sports = uniqTrim(req.body?.sports || []);
  if (provinces.length === 0) {
    res.status(400);
    throw new Error("Phải chọn ít nhất 1 tỉnh để chấm");
  }
  const invalidSports = sports.filter((s) => !ALLOWED_SPORTS.includes(s));
  if (invalidSports.length) {
    res.status(400);
    throw new Error(`Môn không hợp lệ: ${invalidSports.join(", ")}`);
  }

  user.evaluator = user.evaluator || {};
  user.evaluator.enabled = true; // đảm bảo bật
  user.evaluator.gradingScopes = {
    provinces,
    sports: sports.length ? sports : ["pickleball"],
  };
  await user.save();

  res.json({
    ok: true,
    message: "Đã cập nhật phạm vi chấm",
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      gradingScopes: user.evaluator.gradingScopes,
      evaluatorEnabled: user.evaluator.enabled,
      updatedAt: user.updatedAt,
    },
  });
});

export const promoteToEvaluator = asyncHandler(async (req, res) => {
  const idOrEmail = String(req.body?.idOrEmail || "").trim();
  const provinces = uniqTrim(req.body?.provinces || []);
  const sports = uniqTrim(req.body?.sports || []);
  if (!idOrEmail) {
    res.status(400);
    throw new Error("Thiếu idOrEmail");
  }
  if (provinces.length === 0) {
    res.status(400);
    throw new Error("Phải chọn ít nhất 1 tỉnh để chấm");
  }
  const invalidSports = sports.filter((s) => !ALLOWED_SPORTS.includes(s));
  if (invalidSports.length) {
    res.status(400);
    throw new Error(`Môn không hợp lệ: ${invalidSports.join(", ")}`);
  }

  let user = null;
  if (mongoose.isValidObjectId(idOrEmail)) {
    user = await User.findById(idOrEmail);
  } else if (isEmail(idOrEmail)) {
    user = await User.findOne({ email: idOrEmail.toLowerCase() });
  }
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng để bật quyền chấm");
  }

  // Bật capability, merge scopes
  const curProv = new Set(user.evaluator?.gradingScopes?.provinces || []);
  const curSports = new Set(user.evaluator?.gradingScopes?.sports || []);
  provinces.forEach((p) => curProv.add(p));
  (sports.length ? sports : ["pickleball"]).forEach((s) => curSports.add(s));

  user.evaluator = {
    enabled: true,
    gradingScopes: {
      provinces: Array.from(curProv),
      sports: Array.from(curSports),
    },
  };
  await user.save();

  res.status(201).json({
    ok: true,
    message: "Đã bật quyền chấm và gán phạm vi",
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role, // giữ nguyên
      gradingScopes: user.evaluator.gradingScopes,
      evaluatorEnabled: true,
      updatedAt: user.updatedAt,
    },
  });
});

export const demoteEvaluator = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error("ID không hợp lệ");
  }
  const user = await User.findById(id);
  if (!user) {
    res.status(404);
    throw new Error("Không tìm thấy người dùng");
  }

  // Tắt capability; role giữ nguyên
  user.evaluator = {
    enabled: false,
    gradingScopes: { provinces: [], sports: [] },
  };
  await user.save();

  res.json({
    ok: true,
    message: "Đã tắt quyền chấm",
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      gradingScopes: user.evaluator.gradingScopes,
      evaluatorEnabled: false,
      updatedAt: user.updatedAt,
    },
  });
});
