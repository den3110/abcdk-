// routes/authRoutes.js
import express from "express";
import {
  authorize,
  protect,
  protectJwt,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/auth/verify  → 200 + user, hoặc 401
router.get("/verify", protectJwt, authorize("admin", "referee"), (req, res) => {
  // chỉ trả vài field cần thiết
  const { _id, name, email, role } = req.user;
  res.json({ _id, name, email, role });
});

router.post("/logout", protectJwt, authorize("admin"), (req, res) => {
  res.cookie("jwt", "", {
    httpOnly: true,
    expires: new Date(0),
  });
  res.clearCookie("jwt", { path: "/" });
  res.status(200).json({ message: "Logged out successfully" });
});

export default router;
