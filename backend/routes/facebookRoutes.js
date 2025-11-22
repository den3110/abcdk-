// routes/facebookRoutes.js
import express from "express";
import {
  getFacebookLoginUrl,
  facebookCallback,
  getMyFacebookPages,
  deleteFacebookPage,
} from "../controllers/facebookConnectController.js";
import { protect } from "../middleware/authMiddleware.js"; // chỉnh path theo project

const router = express.Router();

// user phải login mới connect được
router.get("/me/facebook/login-url", protect, getFacebookLoginUrl);
router.get("/me/facebook/callback", protect, facebookCallback);
router.get("/me/facebook/pages", protect, getMyFacebookPages);
router.delete("/me/facebook/pages/:id", protect, deleteFacebookPage);

export default router;
