import { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';

const propertySchema = z.object({
  code: z.string().min(3),
  label: z.string().min(2),
  address: z.string().min(5),
  state: z.string().min(2),
  flat_count: z.number().int().positive(),
});

export const propertyController = {
  async registerProperty(req: Request, res: Response) {
    try {
      const validated = propertySchema.parse(req.body);
      const landlord_id = (req as any).user?.id;

      if (!landlord_id) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const [property] = await db('properties').insert({
        landlord_id,
        code: validated.code,
        label: validated.label,
        address: validated.address,
        state: validated.state,
        flat_count: validated.flat_count,
        status: 'ACTIVE'
      }).returning('*');

      res.status(201).json(property);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      res.status(500).json({ error: 'Failed to register property' });
    }
  }
};
