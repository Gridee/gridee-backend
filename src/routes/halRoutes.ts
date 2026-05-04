import { Router } from 'express';
import { halController } from '../controllers/halController';

const router = Router();

router.post('/mock-consume', halController.mockConsume);
router.post('/cutoff', halController.forceCutOff);
router.post('/reconnect', halController.forceReconnect);

export default router;
