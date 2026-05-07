import { Request, Response } from 'express';
import { z } from 'zod';
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
  }
};
