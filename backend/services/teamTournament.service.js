import mongoose from "mongoose";
import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import Registration from "../models/registrationModel.js";
import Match from "../models/matchModel.js";

const { Types } = mongoose;

const TEAM_MODE = "team";
const STANDARD_MODE = "standard";

const toObjectIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value._id) return String(value._id).trim();
  return String(value).trim();
};

const buildPlaceholderFaction = (index) => ({
  _id: new Types.ObjectId(),
  name: `Phe ${index + 1}`,
  captainUser: null,
  order: index,
  isActive: true,
});

export const normalizeTournamentMode = (value) =>
  String(value || "").trim().toLowerCase() === TEAM_MODE
    ? TEAM_MODE
    : STANDARD_MODE;

export const isTeamTournament = (tournament) =>
  normalizeTournamentMode(tournament?.tournamentMode) === TEAM_MODE;

export const normalizeTeamConfig = (rawConfig = {}, existingConfig = {}) => {
  const incoming = Array.isArray(rawConfig?.factions) ? rawConfig.factions : [];
  const existing = Array.isArray(existingConfig?.factions)
    ? existingConfig.factions
    : [];

  const normalized = incoming
    .map((item, index) => {
      const existingAtIndex = existing[index] || {};
      const id = toObjectIdString(item?._id) || toObjectIdString(existingAtIndex?._id);
      const captainUser =
        toObjectIdString(item?.captainUser) ||
        toObjectIdString(existingAtIndex?.captainUser) ||
        null;
      const name = String(item?.name || existingAtIndex?.name || "")
        .replace(/\s+/g, " ")
        .trim();

      return {
        _id:
          id && Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : new Types.ObjectId(),
        name,
        captainUser:
          captainUser && Types.ObjectId.isValid(captainUser)
            ? new Types.ObjectId(captainUser)
            : null,
        order: Number.isFinite(Number(item?.order))
          ? Number(item.order)
          : Number.isFinite(Number(existingAtIndex?.order))
            ? Number(existingAtIndex.order)
            : index,
        isActive: item?.isActive !== false,
      };
    })
    .filter((item) => item.name);

  while (normalized.length < 2) {
    normalized.push(buildPlaceholderFaction(normalized.length));
  }

  return {
    factions: normalized
      .slice(0, 2)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item, index) => ({
        ...item,
        order: index,
        isActive: item.isActive !== false,
      })),
  };
};

export const getTeamFactions = (tournament) =>
  Array.isArray(tournament?.teamConfig?.factions)
    ? tournament.teamConfig.factions
        .filter((item) => item && item.isActive !== false)
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    : [];

export const findTeamFaction = (tournament, factionId) => {
  const key = toObjectIdString(factionId);
  if (!key) return null;
  return (
    getTeamFactions(tournament).find(
      (faction) => String(faction?._id || "") === key
    ) || null
  );
};

export const isAdminLike = (user) =>
  !!(
    user?.isAdmin ||
    user?.role === "admin" ||
    (Array.isArray(user?.roles) &&
      (user.roles.includes("admin") ||
        user.roles.includes("superadmin") ||
        user.roles.includes("superuser")))
  );

export const isTournamentOwner = (userId, tournament) =>
  !!userId &&
  !!tournament &&
  String(tournament?.createdBy || "") === String(userId);

export const isTournamentManagerLike = async (userId, tournament) => {
  if (!userId || !tournament?._id) return false;
  if (isTournamentOwner(userId, tournament)) return true;

  if (Array.isArray(tournament?.managers) && tournament.managers.length) {
    const found = tournament.managers.some((item) => {
      const key =
        typeof item === "object" && item !== null
          ? item.user || item._id || item
          : item;
      return String(key || "") === String(userId);
    });
    if (found) return true;
  }

  const exists = await TournamentManager.exists({
    tournament: tournament._id,
    user: userId,
  });
  return !!exists;
};

export const isTeamFactionCaptain = (tournament, factionId, userId) => {
  const faction = findTeamFaction(tournament, factionId);
  if (!faction || !userId) return false;
  return String(faction?.captainUser || "") === String(userId);
};

export const canManageTeamFaction = async ({ user, tournament, factionId }) => {
  if (!user || !tournament || !isTeamTournament(tournament)) return false;
  if (isAdminLike(user)) return true;
  if (await isTournamentManagerLike(user?._id || user?.id, tournament)) return true;
  return isTeamFactionCaptain(tournament, factionId, user?._id || user?.id);
};

export const buildTeamRegistrationLabel = (registration, eventType = "double") => {
  if (!registration) return "Chua co doi";
  const p1 =
    registration?.player1?.nickName ||
    registration?.player1?.nickname ||
    registration?.player1?.fullName ||
    "Chua co VDV 1";
  if (String(eventType || "").toLowerCase() === "single") return p1;
  const p2 =
    registration?.player2?.nickName ||
    registration?.player2?.nickname ||
    registration?.player2?.fullName ||
    "Chua co VDV 2";
  return `${p1} / ${p2}`;
};

const matchProjection = [
  "_id",
  "tournament",
  "pairA",
  "pairB",
  "teamFactionAId",
  "teamFactionAName",
  "teamFactionBId",
  "teamFactionBName",
  "winner",
  "status",
  "round",
  "order",
  "code",
  "labelKey",
  "scheduledAt",
  "finishedAt",
  "createdAt",
].join(" ");

export const buildTeamRoster = async (tournamentId) => {
  const tournament = await Tournament.findById(tournamentId)
    .populate("teamConfig.factions.captainUser", "name nickname avatar phone")
    .lean();

  if (!tournament) {
    const error = new Error("Tournament not found");
    error.status = 404;
    throw error;
  }
  if (!isTeamTournament(tournament)) {
    const error = new Error("Tournament is not in team mode");
    error.status = 400;
    throw error;
  }

  const [registrations, matches] = await Promise.all([
    Registration.find({ tournament: tournamentId })
      .sort({ createdAt: 1, code: 1 })
      .lean(),
    Match.find({ tournament: tournamentId })
      .select(matchProjection)
      .populate("pairA", "player1 player2 teamFactionId teamFactionName")
      .populate("pairB", "player1 player2 teamFactionId teamFactionName")
      .sort({ round: 1, order: 1, createdAt: 1 })
      .lean(),
  ]);

  const registrationsByFaction = new Map();
  for (const registration of registrations) {
    const key = String(registration?.teamFactionId || "");
    if (!key) continue;
    if (!registrationsByFaction.has(key)) registrationsByFaction.set(key, []);
    registrationsByFaction.get(key).push(registration);
  }

  const factions = getTeamFactions(tournament).map((faction) => {
    const factionId = String(faction?._id || "");
    const regs = registrationsByFaction.get(factionId) || [];
    return {
      _id: factionId,
      name: faction?.name || "",
      order: Number(faction?.order || 0),
      isActive: faction?.isActive !== false,
      captainUser: faction?.captainUser || null,
      registrations: regs,
      entryCount: regs.length,
    };
  });

  const matchSummary = matches.map((match) => ({
    _id: String(match._id),
    code: String(match?.code || "").trim(),
    labelKey: String(match?.labelKey || "").trim(),
    status: match?.status || "scheduled",
    winner: match?.winner || "",
    teamFactionAId: match?.teamFactionAId ? String(match.teamFactionAId) : "",
    teamFactionAName: match?.teamFactionAName || "",
    teamFactionBId: match?.teamFactionBId ? String(match.teamFactionBId) : "",
    teamFactionBName: match?.teamFactionBName || "",
    pairA: match?.pairA || null,
    pairB: match?.pairB || null,
    scheduledAt: match?.scheduledAt || null,
    finishedAt: match?.finishedAt || null,
  }));

  return {
    tournament: {
      _id: String(tournament._id),
      name: tournament?.name || "",
      eventType: tournament?.eventType || "double",
      tournamentMode: tournament?.tournamentMode || STANDARD_MODE,
    },
    factions,
    matches: matchSummary,
  };
};

export const buildTeamStandings = async (tournamentId) => {
  const tournament = await Tournament.findById(tournamentId)
    .populate("teamConfig.factions.captainUser", "name nickname avatar phone")
    .lean();

  if (!tournament) {
    const error = new Error("Tournament not found");
    error.status = 404;
    throw error;
  }
  if (!isTeamTournament(tournament)) {
    const error = new Error("Tournament is not in team mode");
    error.status = 400;
    throw error;
  }

  const factions = getTeamFactions(tournament).map((faction) => ({
    _id: String(faction?._id || ""),
    name: faction?.name || "",
    order: Number(faction?.order || 0),
    captainUser: faction?.captainUser || null,
    wins: 0,
    losses: 0,
    played: 0,
  }));

  const byId = new Map(factions.map((item) => [item._id, item]));
  const matches = await Match.find({
    tournament: tournamentId,
    status: "finished",
    winner: { $in: ["A", "B"] },
    teamFactionAId: { $ne: null },
    teamFactionBId: { $ne: null },
  })
    .select("winner teamFactionAId teamFactionBId")
    .lean();

  for (const match of matches) {
    const aId = String(match?.teamFactionAId || "");
    const bId = String(match?.teamFactionBId || "");
    const left = byId.get(aId);
    const right = byId.get(bId);
    if (!left || !right) continue;
    left.played += 1;
    right.played += 1;
    if (match.winner === "A") {
      left.wins += 1;
      right.losses += 1;
    } else if (match.winner === "B") {
      right.wins += 1;
      left.losses += 1;
    }
  }

  const standings = factions.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return String(a.name || "").localeCompare(String(b.name || ""), "vi", {
      sensitivity: "base",
    });
  });

  return {
    tournament: {
      _id: String(tournament._id),
      name: tournament?.name || "",
      eventType: tournament?.eventType || "double",
      tournamentMode: tournament?.tournamentMode || STANDARD_MODE,
    },
    standings,
  };
};

export const ensureTeamMatchRegistrations = async ({
  tournament,
  pairAId,
  pairBId,
}) => {
  const [pairA, pairB] = await Promise.all([
    Registration.findById(pairAId).lean(),
    Registration.findById(pairBId).lean(),
  ]);

  if (!pairA || !pairB) {
    const error = new Error("Registration not found");
    error.status = 400;
    throw error;
  }
  if (String(pairA.tournament) !== String(tournament._id)) {
    const error = new Error("pairA does not belong to this tournament");
    error.status = 400;
    throw error;
  }
  if (String(pairB.tournament) !== String(tournament._id)) {
    const error = new Error("pairB does not belong to this tournament");
    error.status = 400;
    throw error;
  }

  const factionA = findTeamFaction(tournament, pairA.teamFactionId);
  const factionB = findTeamFaction(tournament, pairB.teamFactionId);
  if (!factionA || !factionB) {
    const error = new Error("Registrations must belong to active factions");
    error.status = 400;
    throw error;
  }
  if (String(factionA._id) === String(factionB._id)) {
    const error = new Error("Team match must be between two different factions");
    error.status = 400;
    throw error;
  }

  return {
    pairA,
    pairB,
    factionA,
    factionB,
  };
};

export const applyTeamMetadataToMatchInput = ({
  input = {},
  factionA,
  factionB,
}) => ({
  ...input,
  teamFactionAId: factionA ? factionA._id : null,
  teamFactionAName: factionA?.name || "",
  teamFactionBId: factionB ? factionB._id : null,
  teamFactionBName: factionB?.name || "",
});

export const nextTeamMatchOrder = async (tournamentId) => {
  const last = await Match.findOne({ tournament: tournamentId })
    .sort({ order: -1, createdAt: -1 })
    .select("order")
    .lean();
  const order = Number.isFinite(Number(last?.order)) ? Number(last.order) + 1 : 0;
  return order;
};
