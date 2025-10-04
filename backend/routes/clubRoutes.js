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
  requireAuth,
  loadClub,
  loadMembership,
  requireOwner,
  requireAdmin,
} from "../middleware/clubAuth.js";

const router = express.Router();

// Public-ish
router.get("/", listClubs);
router.get("/:id", loadClub, getClub);

// Create
router.post("/", requireAuth, createClub);

// Update (owner/admin)
router.patch(
  "/:id",
  requireAuth,
  loadClub,
  loadMembership,
  requireAdmin,
  updateClub
);

// Members
router.get("/:id/members", requireAuth, loadClub, requireAdmin, listMembers);
router.post(
  "/:id/members",
  requireAuth,
  loadClub,
  loadMembership,
  requireAdmin,
  addMember
);
router.patch(
  "/:id/members/:userId/role",
  requireAuth,
  loadClub,
  loadMembership,
  requireAdmin,
  setRole
);
router.delete(
  "/:id/members/:userId",
  requireAuth,
  loadClub,
  loadMembership,
  requireAdmin,
  kickMember
);
router.delete(
  "/:id/members/me",
  requireAuth,
  loadClub,
  loadMembership,
  leaveClub
);

// Join flow
router.post("/:id/join", requireAuth, loadClub, requestJoin);
router.delete("/:id/join", requireAuth, loadClub, cancelMyJoin);
router.get(
  "/:id/join-requests",
  requireAuth,
  loadClub,
  loadMembership,
  requireAdmin,
  listJoinRequests
);
router.post(
  "/:id/join-requests/:reqId/accept",
  requireAuth,
  loadClub,
  loadMembership,
  requireAdmin,
  acceptJoin
);
router.post(
  "/:id/join-requests/:reqId/reject",
  requireAuth,
  loadClub,
  loadMembership,
  requireAdmin,
  rejectJoin
);

// Ownership
router.post(
  "/:id/transfer-ownership",
  requireAuth,
  loadClub,
  requireOwner,
  transferOwnership
);

export default router;
