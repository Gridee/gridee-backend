import { Router } from 'express';
import authRoutes from './authRoutes';
import paymentRoutes from './paymentRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/payments', paymentRoutes);

export default router;
