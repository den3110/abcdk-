// routes/clubRoutes.js
import express from "express";
import {
  createClub,
  updateClub,
  listClubs,
  getClub,
  listMembers,
  addMember,
  setRole,
  kickMember,
  leaveClub,
  requestJoin,
  cancelMyJoin,
  listJoinRequests,
  acceptJoin,
  rejectJoin,
  transferOwnership,
} from "../controllers/clubController.js";

import {
  loadClub,
  loadMembership,
  requireOwner,
  requireAdmin,
  // NEW:
  ensureClubVisibleToUser,
} from "../middleware/clubAuth.js";

import { passProtect, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

/**
 * Public-ish
 * - list: luôn filter public (trừ mine=true)
 * - detail: ẩn hidden cho người lạ bằng ensureClubVisibleToUser
 */
router.get("/", passProtect, listClubs);
router.get(
  "/:id",
  passProtect, // optional auth
  loadClub, // nạp club theo id/slug
  loadMembership, // lấy membership nếu có
  ensureClubVisibleToUser, // ⬅️ hidden -> 404 nếu không phải member/admin/owner
  getClub
);

/** Create */
router.post("/", passProtect, createClub);

/** Update (owner/admin) */
router.patch(
  "/:id",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  updateClub
);

/** Members (admin only) */
router.get(
  "/:id/members",
  passProtect,
  loadClub,
  loadMembership,
  // requireAdmin,
  listMembers
);
router.post(
  "/:id/members",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  addMember
);
router.patch(
  "/:id/members/:userId",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  setRole
);

/**
 * Rời CLB (tự mình)
 * - KHÔNG ràng buộc :id là ObjectId để cho phép dùng slug
 * - Đặt TRƯỚC route :userId để không bị nuốt 'me'
 */
router.delete("/:id/members/me", protect, loadClub, loadMembership, leaveClub);

/**
 * Kick người khác (admin/owner)
 * - RÀNG BUỘC :userId là ObjectId để tránh đụng 'me'
 * - :id giữ dạng tự do (id hoặc slug) vì loadClub đã xử lý
 */
router.delete(
  "/:id/members/:userId([0-9a-fA-F]{24})",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  kickMember
);

/** Join flow */
router.post(
  "/:id/join",
  protect,
  loadClub,
  loadMembership,
  ensureClubVisibleToUser, // hidden -> 404 với người lạ (obscure existence)
  requestJoin
);
router.delete(
  "/:id/join",
  protect,
  loadClub,
  loadMembership,
  ensureClubVisibleToUser, // hidden -> 404 luôn
  cancelMyJoin
);

router.get(
  "/:id/join-requests",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  listJoinRequests
);
router.post(
  "/:id/join-requests/:reqId/accept",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  acceptJoin
);
router.post(
  "/:id/join-requests/:reqId/reject",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  rejectJoin
);

/** Ownership */
router.post(
  "/:id/transfer-ownership",
  protect,
  loadClub,
  requireOwner,
  transferOwnership
);

router.patch(
  "/:id/members/:userId/role",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  setRole
);


export default router;
