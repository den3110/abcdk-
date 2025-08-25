// controllers/bracketController.js
import expressAsyncHandler from "express-async-handler";
import Bracket from "../../models/bracketModel.js";
import Tournament from "../../models/tournamentModel.js";
import Match from "../../models/matchModel.js";
import Registration from "../../models/registrationModel.js";

// ===== Helpers =====
const isPow2 = (n) => Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
const ceilPow2 = (n) => (n <= 1 ? 1 : 1 << Math.ceil(Math.log2(n)));
const countPaidRegs = async (tournamentId) =>
  Registration.countDocuments({
    tournament: tournamentId,
    "payment.status": "Paid",
  });

// ===== CREATE =====
export const adminCreateBracket = expressAsyncHandler(async (req, res) => {
  const { id } = req.params; // tournament id
  const {
    name,
    type = "knockout",
    stage = 1,
    order = 0,
    drawRounds,
    meta,
    config,
  } = req.body;

  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  const allowed = ["group", "knockout", "roundElim"];
  if (!allowed.includes(type)) {
    res.status(400);
    throw new Error(`type must be one of ${allowed.join(", ")}`);
  }

  // Validate drawRounds nếu có (cho knockout/roundElim)
  let toSaveDrawRounds;
  if (typeof drawRounds !== "undefined") {
    if (!["knockout", "roundElim"].includes(type)) {
      res.status(400);
      throw new Error("drawRounds chỉ áp dụng cho knockout / roundElim");
    }
    const n = Number(drawRounds);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400);
      throw new Error("drawRounds phải là số nguyên dương (>= 1)");
    }
    const paidCount = await countPaidRegs(id);
    const maxRounds = Math.floor(Math.log2(Math.max(0, paidCount)));
    if (maxRounds < 1) {
      res.status(400);
      throw new Error("Không đủ số đội đã thanh toán để thiết lập (cần ≥ 2).");
    }
    if (n > maxRounds) {
      res.status(400);
      throw new Error(
        `drawRounds tối đa là ${maxRounds} (2^${maxRounds} ≤ ${paidCount} đội đã thanh toán).`
      );
    }
    toSaveDrawRounds = n;
  }

  // Sanitize meta nếu có (nhẹ cho UI)
  let toSaveMeta;
  if (meta && typeof meta === "object") {
    const m = {};
    if (Number.isFinite(meta.drawSize))
      m.drawSize = Math.max(2, Number(meta.drawSize));
    if (Number.isFinite(meta.maxRounds))
      m.maxRounds = Math.max(1, Number(meta.maxRounds));
    if (Number.isFinite(meta.expectedFirstRoundMatches))
      m.expectedFirstRoundMatches = Math.max(
        1,
        Number(meta.expectedFirstRoundMatches)
      );
    // Đồng bộ cơ bản: nếu có drawSize → làm tròn & set maxRounds/expected…
    if (m.drawSize) {
      const pow2 = isPow2(m.drawSize) ? m.drawSize : ceilPow2(m.drawSize);
      m.drawSize = pow2;
      m.maxRounds = Math.round(Math.log2(pow2));
      m.expectedFirstRoundMatches = pow2 / 2;
    }
    toSaveMeta = m;
  }

  // Nhận config (nếu FE muốn lưu gì thêm)
  let toSaveConfig;
  if (config && typeof config === "object") {
    toSaveConfig = config;
    // nếu type = roundElim và có config.roundElim.drawSize → làm tròn 2^k
    if (
      toSaveConfig.roundElim &&
      Number.isFinite(toSaveConfig.roundElim.drawSize)
    ) {
      const ds = Number(toSaveConfig.roundElim.drawSize);
      toSaveConfig.roundElim.drawSize = isPow2(ds)
        ? ds
        : ceilPow2(Math.max(2, ds));
    }
    if (
      toSaveConfig.roundElim &&
      Number.isFinite(toSaveConfig.roundElim.cutRounds)
    ) {
      toSaveConfig.roundElim.cutRounds = Math.max(
        1,
        Number(toSaveConfig.roundElim.cutRounds)
      );
    }
  }

  const bracket = await Bracket.create({
    tournament: id,
    name,
    type,
    stage,
    order,
    ...(typeof toSaveDrawRounds !== "undefined"
      ? { drawRounds: toSaveDrawRounds }
      : {}),
    ...(toSaveMeta ? { meta: toSaveMeta } : {}),
    ...(toSaveConfig ? { config: toSaveConfig } : {}),
    createdBy: req.user?._id,
  });

  res.status(201).json(bracket);
});

// ===== LIST (kèm meta trong schema nên trả ra là có) =====
export const getBracketsWithMatches = expressAsyncHandler(async (req, res) => {
  const { id } = req.params; // tournament id
  const list = await Bracket.find({ tournament: id })
    .sort({ order: 1, stage: 1 })
    .populate({
      path: "tournament",
      // chỉ lấy các field cần thiết để payload gọn
      select:
        "_id name image sportType groupId regOpenDate registrationDeadline startDate endDate eventType maxPairs status location expected matchesCount finishedAt",
    })
    .lean();

  res.json(list);
});

// ===== UPDATE =====
export const adminUpdateBracket = expressAsyncHandler(async (req, res) => {
  const { tournamentId, bracketId } = req.params;
  const { name, type, stage, order, drawRounds, meta, config } = req.body;

  const br = await Bracket.findById(bracketId);
  if (!br || String(br.tournament) !== String(tournamentId)) {
    res.status(404);
    throw new Error("Bracket not found in this tournament");
  }

  const allowed = ["group", "knockout", "roundElim"];
  if (type && !allowed.includes(type)) {
    res.status(400);
    throw new Error(`type must be one of ${allowed.join(", ")}`);
  }

  if (typeof name === "string") br.name = name.trim();
  if (type) br.type = type;
  if (Number.isFinite(Number(stage))) br.stage = Number(stage);
  if (Number.isFinite(Number(order))) br.order = Number(order);

  const finalType = br.type;

  if (typeof drawRounds !== "undefined") {
    if (!["knockout", "roundElim"].includes(finalType)) {
      res.status(400);
      throw new Error("Số vòng chỉ áp dụng cho knockout / roundElim");
    }
    const n = Number(drawRounds);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400);
      throw new Error("Số vòng phải là số nguyên dương (>= 1)");
    }
    const paidCount = await countPaidRegs(tournamentId);
    const maxRounds = Math.floor(Math.log2(Math.max(0, paidCount)));
    if (maxRounds < 1) {
      res.status(400);
      throw new Error("Không đủ số đội đã thanh toán để thiết lập (cần ≥ 2).");
    }
    if (n > maxRounds) {
      res.status(400);
      throw new Error(
        `Số vòng tối đa là ${maxRounds} (2^${maxRounds} ≤ ${paidCount} đội đã thanh toán).`
      );
    }
    br.drawRounds = n;
  }

  // Update meta (nhẹ cho UI)
  if (meta && typeof meta === "object") {
    br.meta = br.meta || {};
    if (Number.isFinite(meta.drawSize))
      br.meta.drawSize = Math.max(2, Number(meta.drawSize));
    if (Number.isFinite(meta.maxRounds))
      br.meta.maxRounds = Math.max(1, Number(meta.maxRounds));
    if (Number.isFinite(meta.expectedFirstRoundMatches))
      br.meta.expectedFirstRoundMatches = Math.max(
        1,
        Number(meta.expectedFirstRoundMatches)
      );

    // Đồng bộ nếu có drawSize
    if (br.meta.drawSize) {
      const pow2 = isPow2(br.meta.drawSize)
        ? br.meta.drawSize
        : ceilPow2(br.meta.drawSize);
      br.meta.drawSize = pow2;
      br.meta.maxRounds = Math.round(Math.log2(pow2));
      br.meta.expectedFirstRoundMatches = pow2 / 2;
    }
  }

  // Update config (nếu FE muốn)
  if (config && typeof config === "object") {
    br.config = { ...(br.config?.toObject?.() || br.config || {}), ...config };

    // Chuẩn hoá roundElim nếu có
    if (br.config.roundElim) {
      if (Number.isFinite(br.config.roundElim.drawSize)) {
        const ds = Number(br.config.roundElim.drawSize);
        br.config.roundElim.drawSize = isPow2(ds)
          ? ds
          : ceilPow2(Math.max(2, ds));
      }
      if (Number.isFinite(br.config.roundElim.cutRounds)) {
        br.config.roundElim.cutRounds = Math.max(
          1,
          Number(br.config.roundElim.cutRounds)
        );
      }
    }
  }

  await br.save();
  res.json(br);
});

// ===== DELETE (cascade matches) =====
export const deleteBracketCascade = expressAsyncHandler(async (req, res) => {
  const { tourId, bracketId } = req.params;
  const br = await Bracket.findOne({ _id: bracketId, tournament: tourId });
  if (!br) return res.status(404).json({ message: "Bracket not found" });

  await Match.deleteMany({ bracket: br._id });
  await br.deleteOne();

  res.json({ message: "Bracket deleted (and its matches)" });
});
