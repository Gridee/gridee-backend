import { Router } from 'express';
import { botController } from '../controllers/botController';
import { requireBotSecret } from '../middleware/botAuth';

const router = Router();

router.use(requireBotSecret);

router.post('/users/resolve', botController.resolveUser);
router.patch('/users/role', botController.setUserRole);

router.post('/otp/send', botController.sendOtp);
router.post('/otp/verify', botController.verifyOtp);
router.post('/tenants/register', botController.registerTenant);
router.post('/landlords/register', botController.registerLandlord);

router.post('/payments/intents', botController.createPaymentIntent);

router.get('/properties/:code/validate', botController.validatePropertyCode);
router.post('/properties', botController.createProperty);

router.get('/tenants/:phone/balance', botController.getTenantBalance);
router.get('/tenants/:phone/history', botController.getTenantHistory);

router.get('/landlords/:phone/properties', botController.getLandlordProperties);
router.get('/landlords/:phone/properties/:code', botController.getLandlordPropertyDetails);
router.get('/landlords/:phone/properties/:code/tenants', botController.getLandlordPropertyTenants);
router.get('/landlords/:phone/properties/:code/earnings', botController.getLandlordPropertyEarnings);
router.get('/landlords/:phone/earnings', botController.getLandlordEarnings);
router.get('/landlords/:phone/bank-details', botController.getBankDetails);
router.post('/landlords/:phone/bank-details', botController.saveBankDetails);
router.post('/landlords/:phone/withdrawals', botController.initiateWithdrawal);

router.get('/users/:phone/help', botController.getHelp);
router.get('/tenants/:phone/property', botController.getTenantProperty);

router.post('/landlords/:phone/remove-tenant', botController.removeTenant);

router.get('/sessions/:phone', botController.getSession);
router.post('/sessions/:phone', botController.updateSession);
router.delete('/sessions/:phone', botController.clearSession);

export default router;
