import { Router } from 'express';
import { propertyController } from '../controllers/propertyController';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/', authenticate, propertyController.registerProperty);

export default router;
