import express from 'express';
import {
  authUser,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  getPublicProfile,
} from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';
import { getMatchHistory, getRatingHistory } from '../controllers/profileController.js';

const router = express.Router();

router.post('/', registerUser);
router.post('/auth', authUser);
router.post('/logout', logoutUser);
router.get("/:id/public", getPublicProfile);
router.get("/:id/ratings", getRatingHistory);
router.get("/:id/matches", getMatchHistory);

router
  .route('/profile')
  .get(protect, getUserProfile)
  .put(protect, updateUserProfile);

export default router;
