import { db } from '../db';
import { contractService } from '../services/contractService';

type TenantRow = {
  id: number;
  user_id: number;
  status: 'CONNECTED' | 'DISCONNECTED';
  wallet_address: string;
};

async function getTenantWithWallet(tenantId: number): Promise<TenantRow> {
  const tenant = await db('tenants')
    .join('users', 'tenants.user_id', 'users.id')
    .select(
      'tenants.id',
      'tenants.user_id',
      'tenants.status',
      'users.wallet_address'
    )
    .where('tenants.id', tenantId)
    .first();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  if (!tenant.wallet_address) {
    throw new Error('Tenant wallet not found');
  }

  return {
    id: Number(tenant.id),
    user_id: Number(tenant.user_id),
    status: tenant.status as 'CONNECTED' | 'DISCONNECTED',
    wallet_address: tenant.wallet_address
  };
}

export async function getMeterBalance(tenantId: number): Promise<number> {
  const tenant = await getTenantWithWallet(tenantId);
  return contractService.getMeterBalance(tenant.wallet_address);
}

export async function deductConsumption(tenantId: number, kwhUsed: number): Promise<void> {
  if (kwhUsed <= 0) {
    throw new Error('kwhUsed must be greater than 0');
  }

  const tenant = await getTenantWithWallet(tenantId);
  await contractService.deductTokens(tenant.wallet_address, kwhUsed);
  console.log(`Consumption deducted for tenant ${tenantId}: ${kwhUsed}kWh`);
}

export async function cutOff(tenantId: number): Promise<void> {
  const updatedRows = await db('tenants')
    .where({ id: tenantId })
    .update({ status: 'DISCONNECTED' });

  if (!updatedRows) {
    throw new Error('Tenant not found');
  }

  console.log(`Tenant ${tenantId} cut off`);
}

export async function reconnect(tenantId: number): Promise<void> {
  const updatedRows = await db('tenants')
    .where({ id: tenantId })
    .update({ status: 'CONNECTED' });

  if (!updatedRows) {
    throw new Error('Tenant not found');
  }

  console.log(`Tenant ${tenantId} reconnected`);
}

export async function getStatus(tenantId: number): Promise<'CONNECTED' | 'DISCONNECTED'> {
  const tenant = await db('tenants').where({ id: tenantId }).select('status').first();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const status = tenant.status as 'CONNECTED' | 'DISCONNECTED';
  if (status !== 'CONNECTED' && status !== 'DISCONNECTED') {
    throw new Error('Invalid tenant status');
  }

  return status;
}

export async function registerMeter(tenantId: number, deviceId: string): Promise<void> {
  const tenant = await db('tenants').where({ id: tenantId }).first();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await db('meters').insert({
    tenant_id: tenantId,
    device_id: deviceId
  });
}
