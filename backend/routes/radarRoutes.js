import express from "express";
import { protect } from "../middleware/authMiddleware.js"; // Lưu ý: thêm .js
import {
  getRadarSettings,
  updateRadarSettings,
  updateRadarPresence,
  getNearbyPlayers,
  upsertRadarIntent,
  deleteRadarIntent,
  pingUser,
} from "../controllers/radarController.js"; // Lưu ý: thêm .js

const router = express.Router();

router.get("/settings", protect, getRadarSettings);
router.patch("/settings", protect, updateRadarSettings);

router.post("/presence", protect, updateRadarPresence);

router.get("/nearby", protect, getNearbyPlayers);

router.put("/intent", protect, upsertRadarIntent);
router.delete("/intent", protect, deleteRadarIntent);

router.post("/ping", protect, pingUser);

export default router;