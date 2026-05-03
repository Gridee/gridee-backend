import { Request, Response } from 'express';
import { z } from 'zod';
import { deductConsumption } from '../hal';

const mockConsumeSchema = z.object({
  tenantId: z.number().int().positive(),
  kwhAmount: z.number().positive()
});

export const halController = {
  async mockConsume(req: Request, res: Response): Promise<void> {
    try {
      if (process.env.IS_DEV !== 'true') {
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
  }
};
