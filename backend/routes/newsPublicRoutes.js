// src/routes/newsPublicRoutes.js
import express from "express";
import {
  getNewsList,
  getNewsDetail,
} from "../controllers/newsPublicController.js";

const router = express.Router();

router.get("/", getNewsList);
router.get("/:slug", getNewsDetail);

export default router;
