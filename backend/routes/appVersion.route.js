// routes/appVersion.route.js
import { Router } from "express";
import {
  getVersion,
  upsertConfig,
} from "../controllers/appVersion.controller.js";
import {
  authorize,
  protect,
  protectJwt,
} from "../middleware/authMiddleware.js";
// import { requireAdmin } from "../middlewares/auth.js"; // nếu có

const router = Router();

// Chạy versionGate trước các route app (ở app.js tầm global):
// app.use(versionGate);

router.get("/version", getVersion);
router.post("/version",protect, authorize("admin"), upsertConfig);

export default router;
