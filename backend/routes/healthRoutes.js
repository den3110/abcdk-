import express from "express";
import { getPublicStatus } from "../controllers/publicStatusController.js";

const router = express.Router();

router.get("/status", getPublicStatus);

export default router;
