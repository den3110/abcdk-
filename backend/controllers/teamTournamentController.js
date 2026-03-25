import asyncHandler from "express-async-handler";
import Tournament from "../models/tournamentModel.js";
import Match from "../models/matchModel.js";
import { canManageTournament } from "../utils/tournamentAuth.js";
import {
  applyTeamMetadataToMatchInput,
  buildTeamRoster,
  buildTeamStandings,
  ensureTeamMatchRegistrations,
  isAdminLike,
  isTeamTournament,
  isTournamentManagerLike,
  isTournamentOwner,
  nextTeamMatchOrder,
} from "../services/teamTournament.service.js";

export const getTeamRoster = asyncHandler(async (req, res) => {
  const payload = await buildTeamRoster(req.params.id);
  res.json(payload);
});

export const getTeamStandings = asyncHandler(async (req, res) => {
  const payload = await buildTeamStandings(req.params.id);
  res.json(payload);
});

export const createTeamMatch = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { pairA, pairB, scheduledAt = null, note = "", referee = [] } = req.body || {};

  const tournament = await Tournament.findById(id).select(
    "_id name eventType tournamentMode teamConfig createdBy managers"
  );
  if (!tournament) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  if (!isTeamTournament(tournament)) {
    res.status(400);
    throw new Error("Tournament is not in team mode");
  }

  const userId = req.user?._id || req.user?.id;
  const allowed =
    isAdminLike(req.user) ||
    isTournamentOwner(userId, tournament) ||
    (await isTournamentManagerLike(userId, tournament)) ||
    (await canManageTournament(req.user, tournament._id));
  if (!allowed) {
    res.status(403);
    throw new Error("Forbidden");
  }

  if (!pairA || !pairB) {
    res.status(400);
    throw new Error("pairA and pairB are required");
  }
  if (String(pairA) === String(pairB)) {
    res.status(400);
    throw new Error("pairA and pairB must be different");
  }

  const { factionA, factionB } = await ensureTeamMatchRegistrations({
    tournament,
    pairAId: pairA,
    pairBId: pairB,
  });

  const order = await nextTeamMatchOrder(tournament._id);
  const displayCode = `V1-T${order + 1}`;

  const match = await Match.create(
    applyTeamMetadataToMatchInput({
      input: {
        tournament: tournament._id,
        bracket: null,
        round: 1,
        order,
        code: displayCode,
        labelKey: displayCode,
        status: "scheduled",
        pairA,
        pairB,
        rules: {
          bestOf: 3,
          pointsToWin: 11,
          winByTwo: true,
          cap: { mode: "none", points: null },
        },
        scheduledAt: scheduledAt || null,
        note: String(note || "").trim(),
        referee: Array.isArray(referee) ? referee : referee ? [referee] : [],
      },
      factionA,
      factionB,
    })
  );

  const populated = await Match.findById(match._id)
    .populate("pairA", "player1 player2 teamFactionId teamFactionName")
    .populate("pairB", "player1 player2 teamFactionId teamFactionName")
    .lean();

  res.status(201).json(populated);
});
