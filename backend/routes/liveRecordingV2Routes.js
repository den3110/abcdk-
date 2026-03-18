import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  completeLiveRecordingSegmentV2,
  finalizeLiveRecordingV2,
  getLiveRecordingByMatchV2,
  playLiveRecordingV2,
  presignLiveRecordingSegmentV2,
  startLiveRecordingV2,
} from "../controllers/liveRecordingV2Controller.js";

const router = express.Router();

router.post("/start", protect, startLiveRecordingV2);
router.post("/segments/presign", protect, presignLiveRecordingSegmentV2);
router.post("/segments/complete", protect, completeLiveRecordingSegmentV2);
router.post("/finalize", protect, finalizeLiveRecordingV2);
router.get("/by-match/:matchId", getLiveRecordingByMatchV2);
router.get("/:id/play", playLiveRecordingV2);

export default router;
