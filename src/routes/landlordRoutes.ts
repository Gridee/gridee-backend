import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { landlordController } from '../controllers/landlordController';

const router = Router();

router.use(authMiddleware);

router.get('/properties', landlordController.getProperties);
router.get('/properties/:code', landlordController.getPropertyDetail);
router.get('/properties/:code/tenants', landlordController.getPropertyTenants);
router.get('/earnings', landlordController.getEarnings);
router.get('/earnings/:code', landlordController.getPropertyEarnings);
router.post('/withdraw', landlordController.withdraw);
router.post('/properties/:code/remove-tenant', landlordController.removeTenant);

export default router;
