import { Request, Response } from 'express';
import { tenantService } from '../services/tenantService';

function getAuthTenant(req: Request): { id: number; role: string } | null {
  const user = (req as Request & { user?: { id: number; role: string } }).user;
  if (!user) return null;
  if (user.role !== 'tenant') return null;
  return user;
}

export const tenantController = {
  async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const tenant = getAuthTenant(req);
      if (!tenant) {
        res.status(403).json({ error: 'Tenant access required' });
        return;
      }

      const balance = await tenantService.getBalance(tenant.id);
      res.status(200).json(balance);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Tenant not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getHistory(req: Request, res: Response): Promise<void> {
    try {
      const tenant = getAuthTenant(req);
      if (!tenant) {
        res.status(403).json({ error: 'Tenant access required' });
        return;
      }

      const history = await tenantService.getHistory(tenant.id);
      res.status(200).json({ transactions: history });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Tenant not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async getProperty(req: Request, res: Response): Promise<void> {
    try {
      const tenant = getAuthTenant(req);
      if (!tenant) {
        res.status(403).json({ error: 'Tenant access required' });
        return;
      }

      const property = await tenantService.getProperty(tenant.id);
      res.status(200).json({ property });
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Tenant property not found') {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};
