// helpers/socketAuth.js
import mongoose from "mongoose";
import User from "../models/userModel.js";

const USER_SOCKET_SELECT = "_id role isDeleted deletedAt";
const isValidId = (v) => !!v && mongoose.isValidObjectId(String(v));

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
  return u.role === "admin";
};

// referee: role === 'referee' (admin cũng pass)
export const ensureReferee = async (socket, { refresh = true } = {}) => {
  const u = refresh ? await fetchFreshUser(socket) : socket.user;
  if (!u || u.isDeleted || u.deletedAt) return false;
  return u.role === "admin" || u.role === "referee";
};
