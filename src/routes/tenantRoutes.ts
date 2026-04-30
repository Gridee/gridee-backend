import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantController } from '../controllers/tenantController';

const router = Router();

router.use(authMiddleware);

router.get('/balance', tenantController.getBalance);
router.get('/history', tenantController.getHistory);
router.get('/property', tenantController.getProperty);

export default router;
