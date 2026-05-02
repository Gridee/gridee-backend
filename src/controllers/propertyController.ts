import { Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { contractService } from '../services/contractService';
import { AuthRequest } from '../middleware/auth';

import { propertySchema } from '../schemas/propertySchemas';

export const propertyController = {
  async registerProperty(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'landlord') {
        res.status(403).json({ error: 'Forbidden: Only landlords can register properties' });
        return;
      }

      const { address, label, flatCount, state } = propertySchema.parse(req.body);

      // Generate Property Code
      const statePrefix = state.substring(0, 3).toUpperCase();
      
      const countRes = await db('properties')
        .where('state', 'ilike', state)
        .count('* as count')
        .first();
        
      const count = parseInt(String(countRes?.count || '0'), 10);
      const sequence = count + 1;
      
      const code = `GRD-${statePrefix}-${sequence.toString().padStart(4, '0')}`;

      // Insert property
      const [newProperty] = await db('properties').insert({
        landlord_id: req.user.id,
        code,
        label,
        address,
        state,
        flat_count: flatCount,
        status: 'ACTIVE'
      }).returning('*');

      // Call contract service
      await contractService.registerProperty(code, flatCount, address);

      res.status(201).json({
        code: newProperty.code,
        label: newProperty.label,
        address: newProperty.address
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('Property registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};
