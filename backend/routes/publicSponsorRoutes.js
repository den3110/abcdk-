import express from "express";
import { publicListSponsors } from "../controllers/sponsorController.js";

const router = express.Router();
router.get("/", publicListSponsors);
export default router;
