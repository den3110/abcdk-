import expressAsyncHandler from "express-async-handler";
import Bracket from "../../models/bracketModel.js";
import Tournament from "../../models/tournamentModel.js";
import Match from "../../models/matchModel.js";

export const adminCreateBracket = expressAsyncHandler(async (req, res) => {
  const { id } = req.params; // tournament id
  const { name, type = "knockout", stage = 1, order = 0 } = req.body;

  const tour = await Tournament.findById(id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  const bracket = await Bracket.create({
    tournament: id,
    name,
    type,
    stage,
    order,
    createdBy: req.user._id,
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

export const adminUpdateBracket = expressAsyncHandler(async (req, res) => {
  const { tournamentId, bracketId } = req.params;
  const { name, type, stage, order } = req.body;

  const br = await Bracket.findById(bracketId);
  if (!br || String(br.tournament) !== String(tournamentId)) {
    res.status(404);
    throw new Error("Bracket not found in this tournament");
  }

  // Validate đơn giản
  if (type && !["group", "knockout"].includes(type)) {
    res.status(400);
    throw new Error("type must be 'group' or 'knockout'");
  }

  if (typeof name === "string") br.name = name.trim();
  if (type) br.type = type;
  if (Number.isFinite(Number(stage))) br.stage = Number(stage);
  if (Number.isFinite(Number(order))) br.order = Number(order);

  await br.save();
  res.json(br);
});
