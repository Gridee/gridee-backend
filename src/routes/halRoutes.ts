import { Router } from 'express';
import { halController } from '../controllers/halController';

const router = Router();

router.post('/mock-consume', halController.mockConsume);

export default router;
