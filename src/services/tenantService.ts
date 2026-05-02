import { db } from '../db';
import { getMeterBalance } from '../hal';

const GRD_PER_NGN = Number(process.env.GRD_PRICE_PER_NGN || '0');
const HOURS_PER_GRD = Number(process.env.EST_HOURS_PER_GRD || '1');

export const tenantService = {
  async getBalance(tenantUserId: number): Promise<{
    grdBalance: number;
    ngnEquivalent: number;
    estimatedHoursRemaining: number;
  }> {
    const tenant = await db('tenants').where({ user_id: tenantUserId }).first('id');
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const grdBalance = await getMeterBalance(Number(tenant.id));
    const ngnEquivalent = GRD_PER_NGN > 0 ? Number((grdBalance / GRD_PER_NGN).toFixed(2)) : 0;
    const estimatedHoursRemaining = Number((grdBalance * HOURS_PER_GRD).toFixed(2));

    return {
      grdBalance: Number(grdBalance.toFixed(4)),
      ngnEquivalent,
      estimatedHoursRemaining
    };
  },

  async getHistory(tenantUserId: number): Promise<unknown[]> {
    const tenant = await db('tenants').where({ user_id: tenantUserId }).first('id');
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return db('transactions')
      .where({ tenant_id: tenant.id })
      .select('id', 'amount_ngn', 'grd_amount', 'payment_method', 'payment_ref', 'status', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(10);
  },

  async getProperty(tenantUserId: number): Promise<unknown> {
    const tenant = await db('tenants')
      .join('properties', 'tenants.property_id', 'properties.id')
      .where('tenants.user_id', tenantUserId)
      .select(
        'properties.id',
        'properties.code',
        'properties.label',
        'properties.address',
        'properties.state',
        'properties.flat_count',
        'properties.status',
        'tenants.status as tenant_status'
      )
      .first();

    if (!tenant) {
      throw new Error('Tenant property not found');
    }

    return tenant;
  }
};
