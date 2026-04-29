import { Router } from 'express';
import { paymentController } from '../controllers/paymentController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.post('/initiate', authMiddleware, paymentController.initiate);
router.post('/webhook', paymentController.webhook);

export default router;
