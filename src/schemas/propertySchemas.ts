import { z } from 'zod';

export const propertySchema = z.object({
  address: z.string().min(5),
  label: z.string().min(2),
  flatCount: z.number().int().positive(),
  state: z.string().min(2),
});
