import express from "express";
import {
  getSeoNewsDetail,
  getSeoNewsImageProxy,
  getSeoNewsList,
  getSeoNewsSitemap,
} from "../controllers/seoNewsPublicController.js";

const router = express.Router();

router.get("/sitemap.xml", getSeoNewsSitemap);
router.get("/image-proxy", getSeoNewsImageProxy);
router.get("/", getSeoNewsList);
router.get("/:slug", getSeoNewsDetail);

export default router;
