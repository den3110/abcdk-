import express from "express";
import {
  getPublicBlogHomepageBanner,
  getPublicBlogPostBySlug,
} from "../controllers/blogPostController.js";

const router = express.Router();

router.get("/homepage-banner", getPublicBlogHomepageBanner);
router.get("/:slug", getPublicBlogPostBySlug);

export default router;
