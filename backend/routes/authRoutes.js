// routes/authRoutes.js
import express from "express";
import { authorize, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/auth/verify  → 200 + user, hoặc 401
router.get("/verify", protect, authorize("admin"), (req, res) => {
  // chỉ trả vài field cần thiết
  const { _id, name, email, role } = req.user;
  res.json({ _id, name, email, role });
});

export default router;
