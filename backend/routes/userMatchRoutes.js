// routes/userMatchRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  listMyUserMatches,
  createUserMatch,
  getUserMatchById,
  updateUserMatch,
  deleteUserMatch,
  searchPlayersForUserMatch,
} from "../controllers/userMatchController.js";

const router = express.Router();

router
  .route("/")
  .get(protect, listMyUserMatches)
  .post(protect, createUserMatch);

router
  .route("/:id([0-9a-fA-F]{24})")
  .get(protect, getUserMatchById)
  .put(protect, updateUserMatch)
  .delete(protect, deleteUserMatch);

router.route("/players").get(protect, searchPlayersForUserMatch);

export default router;
