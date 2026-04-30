import { Request, Response } from 'express';
import { z } from 'zod';
import { redis } from '../redis';
import { db } from '../db';
import { otpService } from '../services/otpService';
import { assignWallet } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import { registerSchema, tenantRegisterSchema, verifySchema } from '../schemas/authSchemas';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

export const authController = {
  async registerLandlord(req: Request, res: Response): Promise<void> {
    try {
      const { name, phone } = registerSchema.parse(req.body);
      
      // Store pending registration in Redis with 10-min (600s) TTL
      await redis.setex(`reg:${phone}`, 600, JSON.stringify({ name, phone, role: 'landlord' }));
      
      await otpService.sendOTP(phone);
      
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

  async registerTenant(req: Request, res: Response): Promise<void> {
    try {
      const { name, phone, propertyCode } = tenantRegisterSchema.parse(req.body);

      // Validate property code exists and is active
      const property = await db('properties').where({ code: propertyCode }).first();
      if (!property) {
        res.status(404).json({ error: "That Property Code wasn't found. Please check with your landlord and try again." });
        return;
      }

      // Store pending registration in Redis with 10-min (600s) TTL
      await redis.setex(`reg:${phone}`, 600, JSON.stringify({ 
        name, 
        phone, 
        role: 'tenant', 
        propertyId: property.id 
      }));

      await otpService.sendOTP(phone);

      res.status(200).json({ message: 'OTP sent successfully' });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('Tenant Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  async verify(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = verifySchema.parse(req.body);

      const isValid = await otpService.verifyOTP(phone, code);
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

      // If role is tenant, link them to their property
      if (pendingReg.role === 'tenant') {
        await db('tenants').insert({
          user_id: newUser.id,
          property_id: pendingReg.propertyId,
          status: 'CONNECTED'
        });

        // Notify the landlord about the new tenant
        await notificationService.notifyLandlord(pendingReg.propertyId, newUser.name);
      }

      // Assign a custodial wallet on-chain
      await assignWallet(newUser.id, '');
      const walletAddress = '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0'); // Temporary mock for DB

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
