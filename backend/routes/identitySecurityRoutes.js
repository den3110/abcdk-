import express from "express";
import { authorize, protect } from "../middleware/authMiddleware.js";
import {
  explainIdentitySecurityUser,
  explainMyIdentitySecurity,
  getIdentitySecurityOverview,
  getIdentitySecurityUser,
  getMyIdentitySecurity,
} from "../controllers/identitySecurityController.js";

const router = express.Router();

router.get("/me", protect, getMyIdentitySecurity);
router.post("/me/explain", protect, explainMyIdentitySecurity);

router.get("/overview", protect, authorize("admin"), getIdentitySecurityOverview);
router.get("/users/:userId", protect, authorize("admin"), getIdentitySecurityUser);
router.post("/users/:userId/explain", protect, authorize("admin"), explainIdentitySecurityUser);

export default router;
