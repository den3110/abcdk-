// src/routes/weatherRoutes.js
import express from "express";
import {
  getWeatherByCoords,
  getWeatherForTournament,
} from "../controllers/weatherController.js";

const router = express.Router();

// /api/weather?lat=...&lon=...
router.get("/", getWeatherByCoords);

// /api/weather/tournament/:tid
router.get("/tournament/:tid", getWeatherForTournament);

export default router;
