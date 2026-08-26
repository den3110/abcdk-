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
  banMember,
  unbanMember,
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
import { createAnnouncement, deleteAnnouncement, listAnnouncements, updateAnnouncement } from "../controllers/announcementController.js";
import { createPoll, deletePoll, listPolls, votePoll, closePoll } from "../controllers/pollController.js";
import { createEvent, deleteEvent, getEventIcs, listEvents, rsvpEvent, updateEvent, listEventAttendees } from "../controllers/eventController.js";
import {
  listPosts,
  createPost,
  updatePost,
  deletePost,
  reactPost,
  listComments,
  createComment,
  deleteComment,
} from "../controllers/discussionController.js";
import {
  listPhotos,
  addPhotos,
  deletePhoto,
} from "../controllers/galleryController.js";
import {
  listTransactions,
  financeSummary,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  exportTransactionsCsv,
} from "../controllers/financeController.js";
import {
  getDuesConfig,
  setDuesConfig,
  getPeriodStatus,
  payDues,
  unpayDues,
  getMyDues,
} from "../controllers/duesController.js";
import {
  listSessions,
  createSession,
  updateSession,
  deleteSession,
  checkinSession,
  listAttendance,
  attendanceStats,
} from "../controllers/sessionController.js";

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

/** Cấm / bỏ cấm thành viên (admin/owner) */
router.post(
  "/:id/members/:userId([0-9a-fA-F]{24})/ban",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  banMember
);
router.post(
  "/:id/members/:userId([0-9a-fA-F]{24})/unban",
  protect,
  loadClub,
  loadMembership,
  requireAdmin,
  unbanMember
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

// ========== ANNOUNCEMENTS ==========
router.get("/:id/announcements", passProtect, loadClub, loadMembership, listAnnouncements);
router.post("/:id/announcements", protect, loadClub, loadMembership, requireAdmin, createAnnouncement);
router.patch("/:id/announcements/:annId", protect, loadClub, loadMembership, requireAdmin, updateAnnouncement);
router.delete("/:id/announcements/:annId", protect, loadClub, loadMembership, requireAdmin, deleteAnnouncement);

// ========== POLLS ==========
router.get("/:id/polls", passProtect, loadClub, loadMembership, listPolls);
router.post("/:id/polls", protect, loadClub, loadMembership, requireAdmin, createPoll);
router.post("/:id/polls/:pollId/vote", protect, loadClub, loadMembership, votePoll);
router.delete("/:id/polls/:pollId", protect, loadClub, loadMembership, requireAdmin, deletePoll);
router.post("/:id/polls/:pollId/close", protect, loadClub, loadMembership, requireAdmin, closePoll);

// ========== EVENTS ==========
router.get("/:id/events", passProtect, loadClub, loadMembership, listEvents);
router.post("/:id/events", protect, loadClub, loadMembership, requireAdmin, createEvent);
router.patch("/:id/events/:eventId", protect, loadClub, loadMembership, requireAdmin, updateEvent);
router.delete("/:id/events/:eventId", protect, loadClub, loadMembership, requireAdmin, deleteEvent);
router.post("/:id/events/:eventId/rsvp", protect, loadClub, loadMembership, rsvpEvent);
router.get("/:id/events/:eventId/attendees", passProtect, loadClub, loadMembership, listEventAttendees);
router.get("/:id/events/:eventId/ics", passProtect, loadClub, loadMembership, getEventIcs);

// ========== DISCUSSION (tường thảo luận) ==========
router.get("/:id/posts", passProtect, loadClub, loadMembership, listPosts);
router.post("/:id/posts", protect, loadClub, loadMembership, createPost);
router.patch("/:id/posts/:postId", protect, loadClub, loadMembership, updatePost);
router.delete("/:id/posts/:postId", protect, loadClub, loadMembership, deletePost);
router.post("/:id/posts/:postId/react", protect, loadClub, loadMembership, reactPost);
router.get("/:id/posts/:postId/comments", passProtect, loadClub, loadMembership, listComments);
router.post("/:id/posts/:postId/comments", protect, loadClub, loadMembership, createComment);
router.delete("/:id/posts/:postId/comments/:commentId", protect, loadClub, loadMembership, deleteComment);

// ========== GALLERY (thư viện ảnh) ==========
router.get("/:id/photos", passProtect, loadClub, loadMembership, listPhotos);
router.post("/:id/photos", protect, loadClub, loadMembership, addPhotos);
router.delete("/:id/photos/:photoId", protect, loadClub, loadMembership, deletePhoto);

// ========== FINANCE (quỹ thu/chi) ==========
// Xem: thành viên (check trong controller). Quản lý: admin/owner (requireAdmin).
router.get("/:id/finance/summary", protect, loadClub, loadMembership, financeSummary);
router.get("/:id/finance/export.csv", protect, loadClub, loadMembership, exportTransactionsCsv);
router.get("/:id/finance/transactions", protect, loadClub, loadMembership, listTransactions);
router.post("/:id/finance/transactions", protect, loadClub, loadMembership, requireAdmin, createTransaction);
router.patch("/:id/finance/transactions/:txId", protect, loadClub, loadMembership, requireAdmin, updateTransaction);
router.delete("/:id/finance/transactions/:txId", protect, loadClub, loadMembership, requireAdmin, deleteTransaction);

// ========== DUES (phí hội viên định kỳ) ==========
router.get("/:id/dues/config", protect, loadClub, loadMembership, getDuesConfig);
router.put("/:id/dues/config", protect, loadClub, loadMembership, requireAdmin, setDuesConfig);
router.get("/:id/dues/my", protect, loadClub, loadMembership, getMyDues);
router.get("/:id/dues/period", protect, loadClub, loadMembership, requireAdmin, getPeriodStatus);
router.post("/:id/dues/pay", protect, loadClub, loadMembership, requireAdmin, payDues);
router.delete("/:id/dues/pay", protect, loadClub, loadMembership, requireAdmin, unpayDues);

// ========== SESSIONS (buổi tập + điểm danh) ==========
router.get("/:id/sessions/stats", passProtect, loadClub, loadMembership, attendanceStats);
router.get("/:id/sessions", passProtect, loadClub, loadMembership, listSessions);
router.post("/:id/sessions", protect, loadClub, loadMembership, requireAdmin, createSession);
router.patch("/:id/sessions/:sessionId", protect, loadClub, loadMembership, requireAdmin, updateSession);
router.delete("/:id/sessions/:sessionId", protect, loadClub, loadMembership, requireAdmin, deleteSession);
router.post("/:id/sessions/:sessionId/checkin", protect, loadClub, loadMembership, checkinSession);
router.get("/:id/sessions/:sessionId/attendance", passProtect, loadClub, loadMembership, listAttendance);


export default router;
