import { Router } from 'express';
import { authController } from '../controllers/authController';

const router = Router();

router.post('/landlord/register', authController.registerLandlord);
router.post('/tenant/register', authController.registerTenant);
router.post('/verify', authController.verify);

export default router;
