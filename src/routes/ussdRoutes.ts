import { Router } from 'express';
import { ussdController } from '../controllers/ussdController';

const router = Router();

// Africa's Talking USSD endpoint
router.post('/', ussdController.handleRequest);

export default router;
