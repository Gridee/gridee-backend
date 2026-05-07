import { db } from '../db';
import {
  getEnergyBalance,
  deductEnergyTokens,
  setCutOff as setCutOffOnChain,
  isCutOff,
  getTokenBalance,
} from '../services/contractService';

export const HAL = {
  async getMeterBalance(tenantId: number): Promise<number> {
    const tenant = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where('tenants.id', tenantId)
      .select('users.wallet_address')
      .first();

    if (!tenant || !tenant.wallet_address) return 0;

    const balance = await getEnergyBalance(tenant.wallet_address);
    return parseFloat(balance);
  },

  async deductConsumption(tenantId: number, kwhUsed: number): Promise<void> {
    const tenant = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where('tenants.id', tenantId)
      .select('users.wallet_address', 'tenants.status')
      .first();

    if (!tenant || !tenant.wallet_address || tenant.status !== 'CONNECTED') return;

    await deductEnergyTokens(tenant.wallet_address, kwhUsed.toString());
  },

  async cutOff(tenantId: number): Promise<void> {
    const tenant = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where('tenants.id', tenantId)
      .select('users.wallet_address')
      .first();

    if (!tenant) return;

    try {
      if (tenant.wallet_address) {
        await setCutOffOnChain(tenant.wallet_address, true);
      }
      await db('tenants').where({ id: tenantId }).update({ status: 'DISCONNECTED' });
    } catch (error) {
      console.error(`[HAL] cutOff failed for tenant ${tenantId}:`, error);
      throw error;
    }
  },

  async reconnect(tenantId: number): Promise<void> {
    const tenant = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where('tenants.id', tenantId)
      .select('users.wallet_address')
      .first();

    if (!tenant) return;

    try {
      if (tenant.wallet_address) {
        await setCutOffOnChain(tenant.wallet_address, false);
      }
      await db('tenants').where({ id: tenantId }).update({ status: 'CONNECTED' });
    } catch (error) {
      console.error(`[HAL] reconnect failed for tenant ${tenantId}:`, error);
      throw error;
    }
  },

  async getStatus(tenantId: number): Promise<'CONNECTED' | 'DISCONNECTED'> {
    const tenant = await db('tenants')
      .where({ id: tenantId })
      .select('status')
      .first();

    return tenant?.status || 'DISCONNECTED';
  },

  async registerMeter(tenantId: number, deviceId: string): Promise<void> {
    await db('meters').insert({
      tenant_id: tenantId,
      device_id: deviceId,
    });
  },
};

export type { IHardwareLayer } from './IHardwareLayer';
export { MockHardwareLayer, type MockHardwareLayerOptions } from './MockHardwareLayer';
export {
  HardwareLayerFactory,
  type HardwareLayerType,
  type HardwareLayerFactoryConfig,
} from './HardwareLayerFactory';
export {
  type IEnergyBalanceRepository,
  type EnergyBalanceRow,
  type ApplyDeltaInput,
  type ApplyDeltaResult,
  InMemoryEnergyBalanceRepository,
} from './IEnergyBalanceRepository';
export {
  TenantId,
  M_GRD_PER_GRD,
  toGrd,
  toMGrd,
  kwhToMGrd,
  MeterStateSchema,
  type MeterState,
  type MeterStatus,
  type DeductionResult,
  type MintResult,
  type StateChangeResult,
} from './types';
export {
  HalError,
  TenantNotFoundError,
  CannotReconnectZeroBalanceError,
  HalArgumentError,
  HalInfrastructureError,
} from './errors';

export const deductConsumption = HAL.deductConsumption.bind(HAL);
export const getMeterBalance = HAL.getMeterBalance.bind(HAL);
export const cutOff = HAL.cutOff.bind(HAL);
export const reconnect = HAL.reconnect.bind(HAL);
export const getStatus = HAL.getStatus.bind(HAL);
export const registerMeter = HAL.registerMeter.bind(HAL);
