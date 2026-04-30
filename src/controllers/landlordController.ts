import { Request, Response } from 'express';
import { z } from 'zod';
import { landlordService } from '../services/landlordService';

const withdrawSchema = z.object({
  amountNGN: z.number().positive(),
  bankDetails: z.object({
    accountNumber: z.string().min(10),
    bankCode: z.string().min(3),
    accountName: z.string().min(2)
  })
});

const removeTenantSchema = z.object({
  tenantUserId: z.number().int().positive()
});

function getAuthLandlord(req: Request): { id: number; role: string } | null {
  const user = (req as Request & { user?: { id: number; role: string } }).user;
  if (!user) return null;
  if (user.role !== 'landlord') return null;
  return user;
}

function getCodeParam(req: Request): string | null {
  const { code } = req.params;
  if (typeof code !== 'string' || code.trim() === '') {
    return null;
  }
  return code;
}

export const landlordController = {
  async getProperties(req: Request, res: Response): Promise<void> {
    try {
      const landlord = getAuthLandlord(req);
      if (!landlord) {
        res.status(403).json({ error: 'Landlord access required' });
        return;
      }

      const data = await landlordService.getProperties(landlord.id);
      res.status(200).json({ properties: data });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getPropertyDetail(req: Request, res: Response): Promise<void> {
    try {
      const landlord = getAuthLandlord(req);
      if (!landlord) {
        res.status(403).json({ error: 'Landlord access required' });
        return;
      }

      const code = getCodeParam(req);
      if (!code) {
        res.status(400).json({ error: 'Invalid property code' });
        return;
      }

      const property = await landlordService.getPropertyByCode(landlord.id, code);
      res.status(200).json({ property });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Property not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getPropertyTenants(req: Request, res: Response): Promise<void> {
    try {
      const landlord = getAuthLandlord(req);
      if (!landlord) {
        res.status(403).json({ error: 'Landlord access required' });
        return;
      }

      const code = getCodeParam(req);
      if (!code) {
        res.status(400).json({ error: 'Invalid property code' });
        return;
      }

      const tenants = await landlordService.getPropertyTenants(landlord.id, code);
      res.status(200).json({ tenants });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Property not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getEarnings(req: Request, res: Response): Promise<void> {
    try {
      const landlord = getAuthLandlord(req);
      if (!landlord) {
        res.status(403).json({ error: 'Landlord access required' });
        return;
      }

      const earnings = await landlordService.getEarnings(landlord.id);
      res.status(200).json(earnings);
    } catch (error: unknown) {
      if (error instanceof Error && (error.message === 'Landlord not found' || error.message === 'Landlord wallet not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getPropertyEarnings(req: Request, res: Response): Promise<void> {
    try {
      const landlord = getAuthLandlord(req);
      if (!landlord) {
        res.status(403).json({ error: 'Landlord access required' });
        return;
      }

      const code = getCodeParam(req);
      if (!code) {
        res.status(400).json({ error: 'Invalid property code' });
        return;
      }

      const earnings = await landlordService.getPropertyEarnings(landlord.id, code);
      res.status(200).json(earnings);
    } catch (error: unknown) {
      if (error instanceof Error && (error.message === 'Property not found' || error.message === 'Landlord not found' || error.message === 'Landlord wallet not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async withdraw(req: Request, res: Response): Promise<void> {
    try {
      const landlord = getAuthLandlord(req);
      if (!landlord) {
        res.status(403).json({ error: 'Landlord access required' });
        return;
      }

      const body = withdrawSchema.parse(req.body);
      const result = await landlordService.withdraw(landlord.id, body.amountNGN, body.bankDetails);
      res.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      if (error instanceof Error && error.message === 'Landlord not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async removeTenant(req: Request, res: Response): Promise<void> {
    try {
      const landlord = getAuthLandlord(req);
      if (!landlord) {
        res.status(403).json({ error: 'Landlord access required' });
        return;
      }

      const code = getCodeParam(req);
      if (!code) {
        res.status(400).json({ error: 'Invalid property code' });
        return;
      }

      const body = removeTenantSchema.parse(req.body);
      await landlordService.removeTenant(landlord.id, code, body.tenantUserId);
      res.status(200).json({ message: 'Tenant disconnected successfully' });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      if (error instanceof Error && (error.message === 'Property not found' || error.message === 'Tenant not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};
