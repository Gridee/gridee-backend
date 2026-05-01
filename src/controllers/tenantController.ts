import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { db } from '../db';
import { getTokenBalance } from '../services/contractService';

export const tenantController = {
  /**
   * GET /api/tenants/balance
   * Returns on-chain GRD balance, hours remaining, and property info for the logged-in tenant.
   */
  async getBalance(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const user = await db('users').where({ id: userId }).first();
      if (!user || user.role !== 'tenant') {
        res.status(403).json({ error: 'Access denied: User is not a tenant' });
        return;
      }

      const tenant = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .where({ 'tenants.user_id': user.id })
        .select('tenants.*', 'properties.label as propertyLabel')
        .first();

      if (!tenant) {
        res.status(404).json({ error: 'Tenant record or property not found' });
        return;
      }

      const balanceGrd = await getTokenBalance(user.wallet_address || '');
      const consumptionRate = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');
      const hoursLeft = Math.floor(parseFloat(balanceGrd) / consumptionRate);

      const lastTx = await db('transactions')
        .where({ tenant_id: tenant.id, status: 'SUCCESSFUL' })
        .orderBy('created_at', 'desc')
        .first();

      // Calculate NGN equivalent
      const grdPrice = parseFloat(process.env.GRD_PRICE_PER_NGN || '1');
      const balanceNGN = parseFloat(balanceGrd) / grdPrice;

      res.status(200).json({
        balanceGrd: parseFloat(balanceGrd),
        balanceNGN: Math.round(balanceNGN * 100) / 100,
        hoursRemaining: hoursLeft,
        propertyLabel: tenant.propertyLabel,
        lastTopup: lastTx ? lastTx.created_at : 'Never',
        status: tenant.status
      });
    } catch (error) {
      console.error('[api/tenants/balance] error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /**
   * GET /api/tenants/history
   * Returns last 10 transactions for the logged-in tenant.
   */
  async getHistory(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const tenant = await db('tenants').where({ user_id: userId }).first();
      if (!tenant) {
        res.status(404).json({ error: 'Tenant record not found' });
        return;
      }

      const transactions = await db('transactions')
        .where({ tenant_id: tenant.id })
        .orderBy('created_at', 'desc')
        .limit(10);

      res.status(200).json({ transactions });
    } catch (error) {
      console.error('[api/tenants/history] error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};
