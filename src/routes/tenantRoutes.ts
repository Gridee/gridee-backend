import { Router } from 'express';
import { tenantController } from '../controllers/tenantController';
import { authenticate } from '../middleware/auth';
import { db } from '../db';

const router = Router();

router.get('/balance', authenticate as any, tenantController.getBalance);
router.get('/history', authenticate as any, tenantController.getHistory);

router.get('/property', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      res.status(400).json({ error: 'phone query param required' });
      return;
    }

    const user = await db('users').where({ phone, role: 'tenant' }).first();
    if (!user) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const tenantRecord = await db('tenants')
      .join('properties', 'tenants.property_id', 'properties.id')
      .join('users as landlords', 'properties.landlord_id', 'landlords.id')
      .where({ 'tenants.user_id': user.id })
      .select(
        'properties.label',
        'properties.address',
        'landlords.name as landlordName',
        'tenants.status'
      )
      .first();

    if (!tenantRecord) {
      res.status(404).json({ error: 'Property link not found' });
      return;
    }

    res.status(200).json({
      label: tenantRecord.label,
      address: tenantRecord.address,
      landlordName: tenantRecord.landlordName,
      status: tenantRecord.status === 'CONNECTED' ? 'Connected' : 'Disconnected'
    });
  } catch (error) {
    console.error('[api/tenants/property] error:', error);
    res.status(500).json({ error: 'Failed to fetch property' });
  }
});

export default router;
