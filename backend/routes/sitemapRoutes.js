// routes/sitemapRoutes.js — public sitemap endpoints (no auth)
import express from "express";
import {
  getSitemapIndex,
  getSitemapTournaments,
  getSitemapClubs,
} from "../controllers/sitemapController.js";

const router = express.Router();

router.get("/index.xml", getSitemapIndex);
router.get("/tournaments.xml", getSitemapTournaments);
router.get("/clubs.xml", getSitemapClubs);

export default router;
