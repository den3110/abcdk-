import express from 'express';
import { getRankings } from '../controllers/rankingController.js';
const router = express.Router();

router.get('/', getRankings);

export default router;
