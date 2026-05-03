import { Request, Response } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/paymentService';

const initiateSchema = z.object({
  amountNGN: z.number().positive(),
  method: z.enum(['bank_transfer', 'mobile_money', 'crypto'])
});

export const paymentController = {
  async initiate(req: Request, res: Response): Promise<void> {
    try {
      const user = (req as Request & { user?: { id: number } }).user;
      if (!user?.id) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const body = initiateSchema.parse(req.body);
      const result = await paymentService.initiatePayment({
        tenantUserId: user.id,
        amountNGN: body.amountNGN,
        method: body.method
      });

      res.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }

      if (error instanceof Error) {
        if (error.message === 'Tenant profile not found') {
          res.status(404).json({ error: error.message });
          return;
        }
        res.status(400).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async webhook(req: Request, res: Response): Promise<void> {
    try {
      const webhookHash = req.header('verif-hash');
      const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;

      if (!webhookHash || !expectedHash || webhookHash !== expectedHash) {
        res.status(401).json({ error: 'Invalid webhook hash' });
        return;
      }

      const result = await paymentService.processFlutterwaveWebhook(req.body);
      if (!result.processed) {
        res.status(200).json({ message: 'Webhook ignored' });
        return;
      }

      res.status(200).json({ message: 'Webhook processed' });
    } catch (error) {
      console.error('Payment webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};
