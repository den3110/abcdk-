import { Router } from "express";
import { ytCallback } from "../controllers/youtubeSetupController.js";
import {
  approveAuthorizeRequest,
  exchangeAuthorizeCode,
  getAuthorizeContext,
} from "../controllers/oauthController.js";

const router = Router();

router.get("/google/youtube/callback", ytCallback); // public callback
router.get("/authorize/context", getAuthorizeContext);
router.post("/authorize/approve", approveAuthorizeRequest);
router.post("/token", exchangeAuthorizeCode);


export default router;
