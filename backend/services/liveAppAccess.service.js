import Tournament from "../models/tournamentModel.js";
import TournamentManager from "../models/tournamentManagerModel.js";
import { listManageableCourtClustersForUser } from "./courtCluster.service.js";

function normalizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function mapTournament(doc) {
  return {
    _id: String(doc._id),
    name: normalizeText(doc.name, "Giải đấu"),
    title: normalizeText(doc.name, "Giải đấu"),
    sportType: doc.sportType ?? null,
    status: normalizeText(doc.status),
    logoUrl:
      normalizeText(doc.overlay?.logoUrl) ||
      normalizeText(doc.logoUrl) ||
      normalizeText(doc.image) ||
      null,
  };
}

function buildRoleSummary(user, manageableCount) {
  if (String(user?.role || "").trim().toLowerCase() === "admin") {
    return "admin";
  }
  return manageableCount > 0 ? "tournament_manager" : "viewer";
}

async function listAdminTournaments() {
  const docs = await Tournament.find({})
    .select("_id name sportType status image overlay.logoUrl updatedAt createdAt")
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();
  return docs.map(mapTournament);
}

async function listManagedTournaments(userId) {
  const managerRows = await TournamentManager.find({ user: userId })
    .select("tournament")
    .lean();
  const tournamentIds = Array.from(
    new Set(
      managerRows
        .map((row) => String(row.tournament || "").trim())
        .filter(Boolean)
    )
  );
  if (!tournamentIds.length) return [];

  const docs = await Tournament.find({ _id: { $in: tournamentIds } })
    .select("_id name sportType status image overlay.logoUrl updatedAt createdAt")
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .lean();
  return docs.map(mapTournament);
}

export async function buildLiveAppBootstrapForUser(user) {
  if (!user?._id) {
    return {
      ok: false,
      authenticated: false,
      canUseLiveApp: false,
      roleSummary: "anonymous",
      manageableTournaments: [],
      manageableCourtClusters: [],
      reason: "unauthorized",
      message: "Bạn cần đăng nhập PickleTour để dùng app live.",
      user: null,
    };
  }

  const isAdmin = String(user.role || "").trim().toLowerCase() === "admin";
  const manageableTournaments = isAdmin
    ? await listAdminTournaments()
    : await listManagedTournaments(user._id);
  const manageableCourtClusters = await listManageableCourtClustersForUser(user);

  const canUseLiveApp =
    isAdmin ||
    manageableTournaments.length > 0 ||
    manageableCourtClusters.length > 0;
  const roleSummary = buildRoleSummary(user, manageableTournaments.length);

  return {
    ok: true,
    authenticated: true,
    canUseLiveApp,
    roleSummary,
    manageableTournaments,
    manageableCourtClusters,
    reason: canUseLiveApp ? null : "live_access_denied",
    message: canUseLiveApp
      ? null
      : "Tài khoản này chưa có quyền dùng PickleTour Live. Cần quyền admin hoặc quản lý giải.",
    user: {
      _id: String(user._id),
      name: normalizeText(user.name),
      nickname: normalizeText(user.nickname),
      email: normalizeText(user.email),
      phone: normalizeText(user.phone),
      role: normalizeText(user.role),
      avatar: normalizeText(user.avatar),
    },
  };
}
