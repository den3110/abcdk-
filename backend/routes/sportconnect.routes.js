// routes/sportconnect.routes.js
import { Router } from "express";
import {
  getLevelPoint,
  postLevelPoint,
} from "../controllers/sportconnect.controller.js";

const router = Router();

// GET: /api/sportconnect/levelpoint?phone=08886...&debug=1
router.get("/levelpoint", getLevelPoint);

// POST: /api/sportconnect/levelpoint  (body: { searchCriterial, sportId?, page?, waitingInformation? })
router.post("/levelpoint", postLevelPoint);

export default router;
