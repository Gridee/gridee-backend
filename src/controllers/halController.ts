import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { cutOff, deductConsumption, reconnect } from '../hal';

const mockConsumeSchema = z.object({
  tenantId: z.number().int().positive(),
  kwhAmount: z.number().positive()
});
const isDevMode = (): boolean =>
  String(process.env.IS_DEV || '').trim().toLowerCase() === 'true';

export const halController = {
  async mockConsume(req: Request, res: Response): Promise<void> {
    try {
      if (!isDevMode()) {
        res.status(403).json({ error: 'This endpoint is only available in development' });
        return;
      }

      const { tenantId, kwhAmount } = mockConsumeSchema.parse(req.body);
      await deductConsumption(tenantId, kwhAmount);

      res.status(200).json({
        message: 'Mock consumption deduction executed',
        tenantId,
        kwhAmount
      });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }

      if (error instanceof Error && error.message === 'Tenant not found') {
        res.status(404).json({ error: error.message });
        return;
      }

      console.error('HAL mock consume error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async forceCutOff(req: Request, res: Response): Promise<void> {
    try {
      if (!isDevMode()) {
        res.status(403).json({ error: 'This endpoint is only available in development' });
        return;
      }
      const { tenantId } = z.object({ tenantId: z.number().int().positive() }).parse(req.body);
      await cutOff(tenantId);
      res.status(200).json({ message: 'Tenant cut off', tenantId });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async forceReconnect(req: Request, res: Response): Promise<void> {
    try {
      if (!isDevMode()) {
        res.status(403).json({ error: 'This endpoint is only available in development' });
        return;
      }
      const { tenantId } = z.object({ tenantId: z.number().int().positive() }).parse(req.body);
      await reconnect(tenantId);
      res.status(200).json({ message: 'Tenant reconnected', tenantId });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getLandlordData(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      console.log(`[HAL/getLandlordData] Searching for phone: ${phone}`);
      
      const user = await db('users').where({ phone }).first();
      
      if (!user) {
        console.log(`[HAL/getLandlordData] No user found with phone: ${phone}`);
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (user.role !== 'landlord') {
        console.log(`[HAL/getLandlordData] User found but role is: ${user.role}`);
        res.status(403).json({ error: 'User is not a landlord' });
        return;
      }

      const landlord = user;
      console.log(`[HAL/getLandlordData] Landlord found: ID ${landlord.id}`);

      const properties = await db('properties').where({ landlord_id: landlord.id });
      const propertyIds = properties.map(p => p.id);

      const tenants = await db('tenants')
        .join('users', 'tenants.user_id', 'users.id')
        .leftJoin('meters', 'tenants.id', 'meters.tenant_id')
        .whereIn('tenants.property_id', propertyIds)
        .select(
          'tenants.id',
          'tenants.property_id',
          'tenants.flat_number',
          'tenants.status',
          'users.name',
          'users.phone',
          'users.wallet_address',
          'meters.cumulative_reading',
          'meters.serial_number'
        );

      const results = properties.map(p => ({
        ...p,
        tenants: tenants.filter(t => t.property_id === p.id)
      }));

      res.status(200).json(results);
    } catch (error) {
      console.error('HAL getLandlordData error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};
