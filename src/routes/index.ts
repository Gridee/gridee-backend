import { Router } from 'express';
import botRoutes from './botRoutes';
import halRoutes from './halRoutes';
import webhookRoutes from './webhookRoutes';

const router = Router();

router.use('/bot', botRoutes);
router.use('/hal', halRoutes);
router.use('/webhooks', webhookRoutes);

export default router;
