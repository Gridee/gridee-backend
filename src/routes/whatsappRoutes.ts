import { Router } from 'express';
import { whatsappController } from '../controllers/whatsappController';

const router = Router();

router.post('/webhook', whatsappController.handleWebhook);

export default router;
