// routes/adminRoutes.js
import express from "express";
import {
  getUsers,
  updateUserRole,
  deleteUser,
  reviewUserKyc,
  updateUserInfo,
} from "../controllers/admin/adminController.js";
import { protect, authorize } from "../middleware/authMiddleware.js";
import { adminLogin } from "../controllers/admin/adminAuthController.js";
import { getUsersWithRank, updateRanking } from "../controllers/rankingController.js";
import { createScoreHistory, listScoreHistory } from "../controllers/scoreHistoryController.js";

const router = express.Router();

router.post("/login", adminLogin);

router.use(protect, authorize("admin")); // tất cả dưới đây cần admin

// router.get("/users", getUsers);
router.put("/users/:id/role", updateUserRole);
router.delete("/users/:id", deleteUser);
router.put("/users/:id", updateUserInfo);
router.put("/users/:id/kyc", reviewUserKyc);    // approve / reject

router.get("/users", getUsersWithRank);   
router.put("/rankings/:id", updateRanking);

router.get ("/score-history",  listScoreHistory);          // ?user=&page=
router.post("/score-history",  createScoreHistory);        // body { userId, ... }

export default router;
