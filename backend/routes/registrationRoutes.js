import express from 'express';
import {
  updatePaymentStatus,
  checkinRegistration,
} from '../controllers/registrationController.js';

const router = express.Router();

router.patch('/:regId/payment', updatePaymentStatus);
router.patch('/:regId/checkin', checkinRegistration);

export default router;
