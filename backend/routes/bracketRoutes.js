import express from "express";
import { getBracket } from "../controllers/bracketController.js";

const router = express.Router();

router.get("/:bracketId", getBracket)

export default router;