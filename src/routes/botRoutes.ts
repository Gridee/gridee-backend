import { Router } from 'express';
import { botController } from '../controllers/botController';

const router = Router();

// OTP routes (consumed by gridee-bot)
router.post('/otp/send', botController.sendOtp);
router.post('/otp/verify', botController.verifyOtp);

// Property validation (consumed by gridee-bot tenant flow)
router.get('/properties/:code/validate', botController.validatePropertyCode);

// Tenant registration (consumed by gridee-bot tenant flow)
router.post('/tenants/register', botController.registerTenant);

export default router;
