import { Router } from 'express';
import authRoutes from './authRoutes';
import halRoutes from './halRoutes';
import paymentRoutes from './paymentRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/payments', paymentRoutes);
router.use('/hal', halRoutes);

export default router;
