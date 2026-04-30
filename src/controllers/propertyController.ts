import { Request, Response } from 'express';
import { db } from '../db';

export const propertyController = {
  async registerProperty(req: Request, res: Response) {
    try {
      const { code, label, address, state, flat_count } = req.body;
      const landlord_id = (req as any).user.id; // From auth middleware

      const [property] = await db('properties').insert({
        landlord_id,
        code,
        label,
        address,
        state,
        flat_count,
        status: 'ACTIVE'
      }).returning('*');

      res.status(201).json(property);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
};
