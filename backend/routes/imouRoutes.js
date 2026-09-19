// routes/imouRoutes.js — Imou owner-app endpoints + public thumbnail proxy.
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  linkImouAccount,
  unlinkImouAccount,
  uploadImouSession,
  getImouSession,
  clearImouSession,
  uploadImouCreds,
  getImouCreds,
  clearImouCreds,
  addImouCam,
  renameImouCam,
  removeImouCam,
  imouThumbProxy,
} from "../controllers/imouController.js";

const router = express.Router();

// Public — thumbnail proxy DHAV → JPEG
router.get("/thumb", imouThumbProxy);

// Owner endpoints (venue-scoped)
router.post("/venues/:id/account", protect, linkImouAccount);
router.delete("/venues/:id/account", protect, unlinkImouAccount);

router.post("/venues/:id/session", protect, uploadImouSession);
router.get("/venues/:id/session", protect, getImouSession);
router.delete("/venues/:id/session", protect, clearImouSession);

router.post("/venues/:id/creds", protect, uploadImouCreds);
router.get("/venues/:id/creds", protect, getImouCreds);
router.delete("/venues/:id/creds", protect, clearImouCreds);

router.post("/venues/:id/courts/:courtId/cams", protect, addImouCam);
router.patch(
  "/venues/:id/courts/:courtId/cams/:deviceId",
  protect,
  renameImouCam,
);
router.delete(
  "/venues/:id/courts/:courtId/cams/:deviceId",
  protect,
  removeImouCam,
);

export default router;
