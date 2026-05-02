import { db } from '../db';
import { contractService } from './contractService';
import { transferService } from './transferService';

type BankDetails = {
  accountNumber: string;
  bankCode: string;
  accountName: string;
};

export const landlordService = {
  async getProperties(landlordId: number): Promise<unknown[]> {
    return db('properties')
      .where({ landlord_id: landlordId })
      .select('id', 'code', 'label', 'address', 'state', 'flat_count', 'status', 'created_at')
      .orderBy('created_at', 'desc');
  },

  async getPropertyByCode(landlordId: number, code: string): Promise<unknown> {
    const property = await db('properties')
      .where({ landlord_id: landlordId, code })
      .first(
        'id',
        'code',
        'label',
        'address',
        'state',
        'flat_count',
        'status',
        'created_at'
      );

    if (!property) {
      throw new Error('Property not found');
    }

    return property;
  },

  async getPropertyTenants(landlordId: number, code: string): Promise<unknown[]> {
    const property = await db('properties').where({ landlord_id: landlordId, code }).first('id');
    if (!property) {
      throw new Error('Property not found');
    }

    return db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where('tenants.property_id', property.id)
      .select(
        'tenants.id',
        'tenants.status',
        'tenants.created_at',
        'users.id as user_id',
        'users.name',
        'users.phone',
        'users.wallet_address'
      )
      .orderBy('tenants.created_at', 'desc');
  },

  async getEarnings(landlordId: number): Promise<{ totalNGN: number; perProperty: Array<{ code: string; amountNGN: number }> }> {
    const landlord = await db('users').where({ id: landlordId, role: 'landlord' }).first('wallet_address');
    if (!landlord) {
      throw new Error('Landlord not found');
    }
    if (!landlord.wallet_address) {
      throw new Error('Landlord wallet not found');
    }

    const properties = await db('properties').where({ landlord_id: landlordId }).select('code');
    const propertyCodes = properties.map((p) => String(p.code));

    return contractService.getLandlordEarnings(landlord.wallet_address, propertyCodes);
  },

  async getPropertyEarnings(landlordId: number, code: string): Promise<{ code: string; amountNGN: number }> {
    const landlord = await db('users').where({ id: landlordId, role: 'landlord' }).first('wallet_address');
    if (!landlord) {
      throw new Error('Landlord not found');
    }
    if (!landlord.wallet_address) {
      throw new Error('Landlord wallet not found');
    }

    const property = await db('properties').where({ landlord_id: landlordId, code }).first('id');
    if (!property) {
      throw new Error('Property not found');
    }

    return contractService.getPropertyEarnings(landlord.wallet_address, code);
  },

  async withdraw(landlordId: number, amountNGN: number, bankDetails: BankDetails): Promise<{ transferReference: string }> {
    return transferService.withdraw(landlordId, amountNGN, bankDetails);
  },

  async removeTenant(landlordId: number, code: string, tenantUserId: number): Promise<void> {
    const property = await db('properties').where({ landlord_id: landlordId, code }).first('id');
    if (!property) {
      throw new Error('Property not found');
    }

    const updatedRows = await db('tenants')
      .where({ property_id: property.id, user_id: tenantUserId })
      .update({ status: 'DISCONNECTED' });

    if (!updatedRows) {
      throw new Error('Tenant not found');
    }
  }
};
