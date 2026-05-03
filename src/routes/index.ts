import { Router } from 'express';
import authRoutes from './authRoutes';
import halRoutes from './halRoutes';
import landlordRoutes from './landlordRoutes';
import paymentRoutes from './paymentRoutes';
import tenantRoutes from './tenantRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/payments', paymentRoutes);
router.use('/hal', halRoutes);
router.use('/landlord', landlordRoutes);
router.use('/tenants', tenantRoutes);

export default router;
