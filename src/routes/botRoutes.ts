import { Router } from 'express';
import { botController } from '../controllers/botController';
import { requireBotSecret } from '../middleware/botAuth';

const router = Router();

router.use(requireBotSecret);

// User management
router.post('/users/resolve', botController.resolveUser);
router.patch('/users/role', botController.setUserRole);

// OTP
router.post('/otp/send', botController.sendOtp);
router.post('/otp/verify', botController.verifyOtp);

// Registration
router.post('/tenants/register', botController.registerTenant);
router.post('/landlords/register', botController.registerLandlord);

// Payments
router.post('/payments/initiate', botController.initiatePayment);

// Properties
router.get('/properties/:code/validate', botController.validatePropertyCode);
router.post('/properties', botController.createProperty);

// Tenant endpoints
router.get('/tenants/:phone/balance', botController.getTenantBalance);
router.get('/tenants/:phone/history', botController.getTenantHistory);
router.get('/tenants/:phone/property', botController.getTenantProperty);

// Landlord endpoints
router.get('/landlords/:phone/properties', botController.getLandlordProperties);
router.get('/landlords/:phone/properties/:code', botController.getLandlordPropertyDetails);
router.get('/landlords/:phone/properties/:code/tenants', botController.getLandlordPropertyTenants);
router.get('/landlords/:phone/earnings', botController.getLandlordEarnings);
router.get('/landlords/:phone/properties/:code/earnings', botController.getLandlordPropertyEarnings);
router.get('/landlords/:phone/bank-details', botController.getBankDetails);
router.post('/landlords/:phone/bank-details', botController.saveBankDetails);
router.post('/landlords/:phone/withdrawals', botController.initiateWithdrawal);
router.post('/landlords/:phone/remove-tenant', botController.removeTenant);

// Help
router.get('/users/:phone/help', botController.getHelp);

// Session management
router.get('/sessions/:phone', botController.getSession);
router.post('/sessions/:phone', botController.updateSession);
router.delete('/sessions/:phone', botController.clearSession);

export default router;
