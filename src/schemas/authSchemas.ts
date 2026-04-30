import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
});

export const tenantRegisterSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
  propertyCode: z.string().startsWith('GRD-'),
});

export const verifySchema = z.object({
  phone: z.string().min(10),
  code: z.string().length(6),
});
