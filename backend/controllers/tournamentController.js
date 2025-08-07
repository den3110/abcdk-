import asyncHandler from "express-async-handler";
import tournamentModel from "../models/tournamentModel.js";

// @desc    Lấy danh sách giải đấu (lọc theo sportType & groupId)
// @route   GET /api/tournaments?sportType=&groupId=
// @access  Public


const getTournaments = asyncHandler(async (req, res) => {
  const { sportType, groupId } = req.query;

  const filter = {};
  if (sportType) filter.sportType = Number(sportType);
  if (groupId) filter.groupId = Number(groupId);

  const tournaments = await tournamentModel
    .find(filter)
    .sort({ startDate: -1 });
  res.json(tournaments);
});
const getTournamentById = asyncHandler(async (req, res) => {
  const tour = await tournamentModel.findById(req.params.id);
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  res.json(tour); // trả toàn bộ, gồm contactHtml & contentHtml
});

export { getTournaments, getTournamentById };
