import expressAsyncHandler from "express-async-handler";
import Bracket from "../../models/bracketModel.js";
import Tournament from "../../models/tournamentModel.js";
import Match from "../../models/matchModel.js";
import Registration from "../../models/registrationModel.js";

export const adminCreateBracket = expressAsyncHandler(async (req, res) => {
  const { id } = req.params; // tournament id
  const {
    name,
    type = "knockout",
    stage = 1,
    order = 0,
    drawRounds,
  } = req.body;

  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }

  if (type && !["group", "knockout"].includes(type)) {
    res.status(400);
    throw new Error("type must be 'group' or 'knockout'");
  }

  let toSaveDrawRounds;
  if (typeof drawRounds !== "undefined") {
    if (type !== "knockout") {
      res.status(400);
      throw new Error("drawRounds chỉ áp dụng cho knockout bracket");
    }

    const n = Number(drawRounds);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400);
      throw new Error("drawRounds phải là số nguyên dương (>= 1)");
    }

    // Đếm số đăng ký đã thanh toán
    const paidCount = await Registration.countDocuments({
      tournament: id,
      "payment.status": "Paid",
    });

    const maxRounds = Math.floor(Math.log2(Math.max(0, paidCount)));
    if (maxRounds < 1) {
      res.status(400);
      throw new Error(
        "Không đủ số đội đã thanh toán để thiết lập knockout (cần ≥ 2)."
      );
    }
    if (n > maxRounds) {
      res.status(400);
      throw new Error(
        `drawRounds tối đa là ${maxRounds} vì 2^${maxRounds} ≤ số đội đã thanh toán (${paidCount}).`
      );
    }

    toSaveDrawRounds = n;
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
    createdBy: req.user?._id, // nếu schema không có field này thì Mongoose sẽ bỏ qua
  });

  res.status(201).json(bracket);
});

export const getBracketsWithMatches = expressAsyncHandler(async (req, res) => {
  const { id } = req.params; // tournament id
  const list = await Bracket.find({ tournament: id }).sort({
    stage: 1,
    order: 1,
  });
  res.json(list);
});

export const deleteBracketCascade = async (req, res) => {
  const { tourId, bracketId } = req.params;
  const br = await Bracket.findOne({ _id: bracketId, tournament: tourId });
  if (!br) return res.status(404).json({ message: "Bracket not found" });

  await Match.deleteMany({ bracket: br._id }); // xoá sạch match thuộc bracket
  await br.deleteOne();

  res.json({ message: "Bracket deleted (and its matches)" });
};

// controllers/bracketController.js (hoặc nơi bạn đang đặt)
export const adminUpdateBracket = expressAsyncHandler(async (req, res) => {
  const { tournamentId, bracketId } = req.params;
  const { name, type, stage, order, drawRounds } = req.body;

  const br = await Bracket.findById(bracketId);
  if (!br || String(br.tournament) !== String(tournamentId)) {
    res.status(404);
    throw new Error("Bracket not found in this tournament");
  }

  // Validate type cơ bản
  if (type && !["group", "knockout"].includes(type)) {
    res.status(400);
    throw new Error("type must be 'group' or 'knockout'");
  }

  // Gán các field cơ bản
  if (typeof name === "string") br.name = name.trim();
  if (type) br.type = type;
  if (Number.isFinite(Number(stage))) br.stage = Number(stage);
  if (Number.isFinite(Number(order))) br.order = Number(order);

  // Xác định type sau khi cập nhật để validate drawRounds
  const finalType = br.type;

  if (typeof drawRounds !== "undefined") {
    if (finalType !== "knockout") {
      res.status(400);
      throw new Error("Số vòng chỉ áp dụng cho knockout bracket");
    }

    const n = Number(drawRounds);
    if (!Number.isInteger(n) || n < 1) {
      res.status(400);
      throw new Error("Số vòng phải là số nguyên dương (>= 1)");
    }

    // Đếm số đăng ký đã thanh toán
    const paidCount = await Registration.countDocuments({
      tournament: tournamentId,
      "payment.status": "Paid",
    });

    const maxRounds = Math.floor(Math.log2(Math.max(0, paidCount)));

    if (maxRounds < 1) {
      res.status(400);
      throw new Error(
        "Không đủ số đội đã thanh toán để thiết lập knockout (cần ≥ 2)."
      );
    }
    if (n > maxRounds) {
      res.status(400);
      throw new Error(
        `Số vòng tối đa là ${maxRounds} vì 2^${maxRounds} ≤ số đội đã thanh toán (${paidCount}).`
      );
    }

    br.drawRounds = n;
  }

  await br.save();
  res.json(br);
});
