import express from 'express';
import { getRankings } from '../controllers/rankingController.js';
import { passProtect } from '../middleware/authMiddleware.js';
const router = express.Router();

router.get('/', passProtect, getRankings);

export default router;
