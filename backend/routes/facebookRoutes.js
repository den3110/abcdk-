// routes/facebookRoutes.js
import express from "express";
import {
  getFacebookLoginUrl,
  facebookCallback,
  getMyFacebookPages,
  deleteFacebookPage,
} from "../controllers/facebookConnectController.js";
import { authorize, protect } from "../middleware/authMiddleware.js"; // chỉnh path theo project
import {
  getPageInfo,
  getPageInfoBulk,
} from "../controllers/facebookPageController.js";

const router = express.Router();

// user phải login mới connect được
router.get("/me/facebook/login-url", protect, getFacebookLoginUrl);
router.get("/me/facebook/callback", facebookCallback);
router.get("/me/facebook/pages", protect, getMyFacebookPages);
router.delete("/me/facebook/pages/:id", protect, deleteFacebookPage);

router.get("/page-info", protect, authorize("admin"), getPageInfo);
router.post("/page-info/bulk", protect, authorize("admin"), getPageInfoBulk);

export default router;
