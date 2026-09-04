// services/emailCampaignService.js
import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import Registration from "../models/registrationModel.js";
import EmailContact from "../models/emailContactModel.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (e) => EMAIL_RE.test(String(e || "").trim());

const UNSUB_SECRET =
  process.env.EMAIL_UNSUB_SECRET ||
  process.env.JWT_SECRET ||
  process.env.ACCESS_TOKEN_SECRET ||
  "pickletour-unsub-secret";

function baseUrl() {
  return (process.env.HOST || "https://pickletour.vn").replace(/\/+$/, "");
}

function sign(payload) {
  return crypto
    .createHmac("sha256", UNSUB_SECRET)
    .update(String(payload))
    .digest("hex")
    .slice(0, 24);
}

// kind: "u" (user) | "c" (contact)
export function buildUnsubToken(kind, id) {
  const subject = `${kind}:${id}`;
  return `${Buffer.from(subject).toString("base64url")}.${sign(subject)}`;
}

export function verifyUnsubToken(token) {
  try {
    const [b64, sig] = String(token || "").split(".");
    if (!b64 || !sig) return null;
    const subject = Buffer.from(b64, "base64url").toString("utf8");
    if (sign(subject) !== sig) return null;
    const [kind, id] = subject.split(":");
    if (!["u", "c"].includes(kind) || !mongoose.isValidObjectId(id)) return null;
    return { kind, id };
  } catch {
    return null;
  }
}

export function userUnsubscribeUrl(userId) {
  if (!userId) return "";
  return `${baseUrl()}/api/email/unsubscribe?u=${buildUnsubToken("u", userId)}`;
}
export function contactUnsubscribeUrl(contactId) {
  if (!contactId) return "";
  return `${baseUrl()}/api/email/unsubscribe?u=${buildUnsubToken("c", contactId)}`;
}

/**
 * Danh sách userId (chuỗi) là VĐV tham gia 1 giải (player1/player2).
 */
export async function tournamentUserIds(tournamentId) {
  if (!mongoose.isValidObjectId(tournamentId)) return [];
  const regs = await Registration.find({ tournament: tournamentId })
    .select("player1.user player2.user")
    .lean();
  const set = new Set();
  for (const r of regs) {
    if (r.player1?.user) set.add(String(r.player1.user));
    if (r.player2?.user) set.add(String(r.player2.user));
  }
  return [...set];
}

/**
 * Filter User cho scope "all" | "tournament".
 */
export async function buildUserFilter(audience = {}) {
  const base = {
    email: { $exists: true, $nin: [null, ""] },
    marketingEmailOptOut: { $ne: true },
    provisionedByImport: { $ne: true },
  };
  if (audience.scope === "tournament") {
    const ids = await tournamentUserIds(audience.tournament);
    base._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  return base;
}

/**
 * Ước lượng số người nhận cho một audience.
 */
export async function countAudience(audience = {}) {
  if (audience.scope === "list") {
    const uniq = new Set(
      (audience.emails || [])
        .map((e) => String(e || "").trim().toLowerCase())
        .filter(isValidEmail)
    );
    return uniq.size;
  }
  if (audience.scope === "contactList") {
    if (!mongoose.isValidObjectId(audience.contactList)) return 0;
    return EmailContact.countDocuments({
      list: audience.contactList,
      optOut: { $ne: true },
    });
  }
  const filter = await buildUserFilter(audience);
  if (audience.scope === "tournament" && (!filter._id || !filter._id.$in.length))
    return 0;
  return User.countDocuments(filter);
}
