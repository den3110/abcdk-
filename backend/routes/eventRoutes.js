// routes/eventRoutes.js — sự kiện "xé vé" phía người chơi (công khai + đăng ký)
import express from "express";
import { protect, attachJwtIfPresent } from "../middleware/authMiddleware.js";
import {
  listPublicEvents,
  getEvent,
  registerEvent,
  listMyEventRegs,
  submitEventProof,
  cancelMyReg,
  checkInEvent,
} from "../controllers/venueEventController.js";

const router = express.Router();

router.get("/", listPublicEvents);
router.get("/mine", protect, listMyEventRegs);
router.post("/checkin", protect, checkInEvent);
router.post("/registrations/:regId/proof", protect, submitEventProof);
router.delete("/registrations/:regId", protect, cancelMyReg);
router.post("/:eventId/register", protect, registerEvent);
router.get("/:eventId", attachJwtIfPresent, getEvent);

export default router;
