import { Router } from "express";
import { ytCallback } from "../controllers/youtubeSetupController.js";
import { recordingDriveOAuthCallback } from "../controllers/recordingDriveSetupController.js";
import {
  authorizeRedirect,
  approveAuthorizeRequest,
  exchangeAuthorizeCode,
  getAuthorizeContext,
} from "../controllers/oauthController.js";

const router = Router();

router.get("/google/youtube/callback", ytCallback); // public callback
router.get("/google/recording-drive/callback", recordingDriveOAuthCallback);
router.get("/authorize", authorizeRedirect);
router.get("/authorize/context", getAuthorizeContext);
router.post("/authorize/approve", approveAuthorizeRequest);
router.post("/token", exchangeAuthorizeCode);


export default router;
