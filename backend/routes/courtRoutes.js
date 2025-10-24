import { getCourtById } from "../controllers/courtController.js";
import express from "express"

const router= express.Router()

router.get("/:courtId", getCourtById);

export default router