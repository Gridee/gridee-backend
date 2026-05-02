import { Router } from 'express';
import { tenantController } from '../controllers/tenantController';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public tenant API (auth-gated)
router.get('/balance', authenticate as any, tenantController.getBalance);
router.get('/history', authenticate as any, tenantController.getHistory);

export default router;
