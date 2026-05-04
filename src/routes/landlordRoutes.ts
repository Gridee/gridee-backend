import { Router } from 'express';
import { db } from '../db';
import { TRANSACTION_STATUS } from '../constants/transactionStatus';

const LANDLORD_SHARE_BPS = parseInt(process.env.LANDLORD_SHARE_BPS || '1800', 10);

const router = Router();

router.get('/properties', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) {
      res.status(400).json({ error: 'phone query param required' });
      return;
    }

    const user = await db('users').where({ phone }).first();
    if (!user || user.role !== 'landlord') {
      res.status(404).json({ error: 'Landlord not found' });
      return;
    }

    const properties = await db('properties')
      .where({ landlord_id: user.id })
      .select('properties.*')
      .orderBy('created_at', 'desc');

    const tenantCounts = await db('tenants')
      .whereIn('property_id', properties.map(p => p.id))
      .groupBy('property_id')
      .select('property_id')
      .count('id as count');

    const countMap = new Map<number, number>();
    tenantCounts.forEach((row: any) => countMap.set(row.property_id, Number(row.count)));

    const enhanced = properties.map(p => ({
      ...p,
      activeTenantCount: countMap.get(p.id) || 0
    }));

    res.status(200).json({ properties: enhanced });
  } catch (error) {
    console.error('[api/landlord/properties] error:', error);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

router.get('/properties/:code/tenants', async (req, res) => {
  try {
    const { code } = req.params;
    const { phone } = req.query;

    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const property = await db('properties').where({ landlord_id: user.id, code }).first();
    if (!property) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    const tenants = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where({ 'tenants.property_id': property.id })
      .select('users.name', 'users.phone', 'tenants.status');

    res.status(200).json({ property: { code: property.code, label: property.label, flatCount: property.flat_count, occupiedCount: tenants.length }, tenants });
  } catch (error) {
    console.error('[api/landlord/properties/tenants] error:', error);
    res.status(500).json({ error: 'Failed to fetch tenants' });
  }
});

router.get('/earnings', async (req, res) => {
  try {
    const { phone } = req.query;
    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const properties = await db('properties').where({ landlord_id: user.id });
    const propertyIds = properties.map(p => p.id);

    const earnings = await db('transactions')
      .whereIn('property_id', propertyIds)
      .where({ status: TRANSACTION_STATUS.COMPLETED })
      .select('property_id')
      .sum('amount_ngn as total')
      .groupBy('property_id');

    const shareMultiplier = LANDLORD_SHARE_BPS / 10000;

    const breakdown = properties.map(p => {
      const pEarnings = earnings.find(e => e.property_id === p.id);
      return {
        code: p.code,
        label: p.label,
        amount: Math.round((Number(pEarnings?.total || 0) * shareMultiplier) * 100) / 100
      };
    });

    const total = breakdown.reduce((sum, item) => sum + item.amount, 0);

    res.status(200).json({ total, breakdown });
  } catch (error) {
    console.error('[api/landlord/earnings] error:', error);
    res.status(500).json({ error: 'Failed to fetch earnings' });
  }
});

router.post('/withdraw', async (req, res) => {
  try {
    const { phone, amountNGN, accountNumber, bankName } = req.body;

    const landlord = await db('users').where({ phone, role: 'landlord' }).first();
    if (!landlord) {
      res.status(404).json({ error: 'Landlord not found' });
      return;
    }

    const bankNameToUse = bankName || landlord.bank_name;
    const accountNumberToUse = accountNumber || landlord.account_number;

    if (!bankNameToUse || !accountNumberToUse) {
      res.status(400).json({ error: 'Bank details required' });
      return;
    }

    if (!landlord.bank_name || !landlord.account_number) {
      await db('users').where({ id: landlord.id }).update({
        bank_name: bankNameToUse,
        account_number: accountNumberToUse
      });
    }

    const [withdrawal] = await db('withdrawals').insert({
      landlord_id: landlord.id,
      amount: amountNGN,
      bank_name: bankNameToUse,
      account_number: accountNumberToUse,
      status: 'PENDING'
    }).returning('*');

    res.status(201).json({
      success: true,
      amount: amountNGN,
      bankName: bankNameToUse,
      bankLast4: accountNumberToUse.slice(-4)
    });
  } catch (error) {
    console.error('[api/landlord/withdraw] error:', error);
    res.status(500).json({ error: 'Failed to initiate withdrawal' });
  }
});

router.post('/properties/:propertyCode/remove-tenant', async (req, res) => {
  try {
    const { propertyCode } = req.params;
    const { phone, tenantPhone } = req.body;

    const landlord = await db('users').where({ phone, role: 'landlord' }).first();
    if (!landlord) {
      res.status(404).json({ error: 'Landlord not found' });
      return;
    }

    const property = await db('properties').where({ landlord_id: landlord.id, code: propertyCode }).first();
    if (!property) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    const tenantUser = await db('users').where({ phone: tenantPhone, role: 'tenant' }).first();
    if (!tenantUser) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const tenantRecord = await db('tenants')
      .where({ user_id: tenantUser.id, property_id: property.id })
      .first();

    if (!tenantRecord) {
      res.status(403).json({ error: 'Tenant not registered under this property' });
      return;
    }

    await db('tenants').where({ id: tenantRecord.id }).update({ status: 'DISCONNECTED' });

    res.status(200).json({
      success: true,
      tenantName: tenantUser.name,
      propertyName: property.label
    });
  } catch (error) {
    console.error('[api/landlord/remove-tenant] error:', error);
    res.status(500).json({ error: 'Failed to remove tenant' });
  }
});

export default router;
