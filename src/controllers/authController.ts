import { Request, Response } from 'express';
import { z } from 'zod';
import { redis } from '../redis';
import { db } from '../db';
import { sendOTP, verifyOTP } from '../services/otpService';
import { contractService } from '../services/contractService';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

const registerSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
});

const verifySchema = z.object({
  phone: z.string().min(10),
  code: z.string().length(6),
});

export const authController = {
  async registerLandlord(req: Request, res: Response): Promise<void> {
    try {
      const { name, phone } = registerSchema.parse(req.body);
      
      // Store pending registration in Redis with 10-min (600s) TTL
      await redis.setex(`reg:${phone}`, 600, JSON.stringify({ name, phone, role: 'landlord' }));
      
      await sendOTP(phone);
      
      res.status(200).json({ message: 'OTP sent successfully' });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async verify(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = verifySchema.parse(req.body);

      const isValid = await verifyOTP(phone, code);
      if (!isValid) {
        res.status(400).json({ error: 'Invalid or expired OTP' });
        return;
      }

      // Check for pending registration
      const pendingRegStr = await redis.get(`reg:${phone}`);
      if (!pendingRegStr) {
        // Fallback to login if no pending registration
        const existingUser = await db('users').where({ phone }).first();
        if (!existingUser) {
          res.status(404).json({ error: 'User not found or registration expired' });
          return;
        }
        
        const token = jwt.sign({ id: existingUser.id, role: existingUser.role }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({ token, user: existingUser });
        return;
      }

      // Complete registration
      const pendingReg = JSON.parse(pendingRegStr);
      
      // Insert user
      const [newUser] = await db('users').insert({
        name: pendingReg.name,
        phone: pendingReg.phone,
        role: pendingReg.role
      }).returning('*');

      // Call contract service
      const walletAddress = await contractService.assignWallet(newUser.id);

      // Update user with wallet address
      const [updatedUser] = await db('users')
        .where({ id: newUser.id })
        .update({ wallet_address: walletAddress })
        .returning('*');

      // Clean up Redis
      await redis.del(`reg:${phone}`);

      const token = jwt.sign({ id: updatedUser.id, role: updatedUser.role }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({ token, user: updatedUser });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('Verification error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};
