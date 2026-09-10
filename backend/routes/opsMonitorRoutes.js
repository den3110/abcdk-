// routes/opsMonitorRoutes.js — API quản trị hệ thống giám sát vận hành.
import express from "express";
import { protect, authorize } from "../middleware/authMiddleware.js";
import {
  getOpsStatus,
  runOpsCheck,
  sendOpsDigestNow,
  testOpsChannel,
  listOpsAlerts,
  muteOpsAlert,
} from "../controllers/admin/opsMonitorController.js";

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/status", getOpsStatus);
router.post("/run", runOpsCheck);
router.post("/digest", sendOpsDigestNow);
router.post("/test", testOpsChannel);
router.get("/alerts", listOpsAlerts);
router.post("/alerts/:key/mute", muteOpsAlert);

export default router;
