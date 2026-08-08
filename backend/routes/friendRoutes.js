// routes/friendRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  sendRequest,
  acceptRequest,
  declineRequest,
  removeEdge,
  listFriends,
  listRequests,
  getStatus,
  getCounts,
  listSuggestions,
  blockUser,
  unblockUser,
  listBlocked,
} from "../controllers/friendController.js";

const router = express.Router();

router.use(protect);
router.get("/", listFriends);
router.get("/requests", listRequests);
router.get("/counts", getCounts);
router.get("/suggestions", listSuggestions);
router.get("/blocked", listBlocked);
router.get("/status/:userId", getStatus);
router.post("/request", sendRequest);
router.post("/:id/accept", acceptRequest);
router.post("/:id/decline", declineRequest);
router.delete("/edge/:id", removeEdge);
router.post("/block/:userId", blockUser);
router.delete("/block/:userId", unblockUser);

export default router;
