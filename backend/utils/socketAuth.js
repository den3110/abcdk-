// helpers/socketAuth.js
import mongoose from "mongoose";
import User from "../models/userModel.js";

const USER_SOCKET_SELECT =
  "_id role roles isAdmin isDeleted deletedAt isSuperUser isSuperAdmin";
const isValidId = (v) => !!v && mongoose.isValidObjectId(String(v));
const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

function isAdminUser(user) {
  if (!user) return false;
  if (user?.isAdmin === true) return true;
  if (normalizeRole(user?.role) === "admin") return true;
  if (Array.isArray(user?.roles)) {
    return user.roles.map(normalizeRole).includes("admin");
  }
  return false;
}

function getUid(socket) {
  return (
    socket?.user?._id ||
    socket?.user?.id ||
    (typeof socket?.user === "string" ? socket.user : null)
  );
}

async function fetchFreshUser(socket) {
  const uid = getUid(socket);
  if (!uid || !isValidId(String(uid))) return null;
  return User.findById(uid).select(USER_SOCKET_SELECT).lean();
}

// admin: role === 'admin'
export const ensureAdmin = async (socket, { refresh = true } = {}) => {
  const u = refresh ? await fetchFreshUser(socket) : socket.user;
  if (!u || u.isDeleted || u.deletedAt) return false;
  return isAdminUser(u);
};

// referee: role === 'referee' (admin cũng pass)
export const ensureReferee = async (socket, { refresh = true } = {}) => {
  const u = refresh ? await fetchFreshUser(socket) : socket.user;
  if (!u || u.isDeleted || u.deletedAt) return false;
  return isAdminUser(u) || normalizeRole(u.role) === "referee";
};

export const ensureAdminAndSuperUser = async (socket, { refresh = true } = {}) => {
  const u = refresh ? await fetchFreshUser(socket) : socket.user;
  if (!u || u.isDeleted || u.deletedAt) return false;
  return isAdminUser(u) && Boolean(u.isSuperUser || u.isSuperAdmin);
};
