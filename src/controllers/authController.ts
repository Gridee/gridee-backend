import { Request, Response } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import { redis } from '../redis';
import { db } from '../db';
import { privyService } from '../services/privyService';
import { otpService } from '../services/otpService';
import { registerLandlordWallet, registerTenantWallet } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import { contractService } from '../services/contractService';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

import { registerSchema, tenantRegisterSchema, verifySchema } from '../schemas/authSchemas';

export const authController = {
  async registerLandlord(req: Request, res: Response): Promise<void> {
    try {
      const { name, phone } = registerSchema.parse(req.body);
      
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

      const property = await db('properties').where({ code: propertyCode }).first();
      if (!property) {
        res.status(404).json({ error: "That Property Code wasn't found. Please check with your landlord and try again." });
        return;
      }

      await redis.setex(`reg:${phone}`, 600, JSON.stringify({ 
        name, 
        phone, 
        role: 'tenant', 
        propertyId: property.id,
        propertyCode: property.code
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

      const pendingRegStr = await redis.get(`reg:${phone}`);
      if (!pendingRegStr) {
        const existingUser = await db('users').where({ phone }).first();
        if (!existingUser) {
          res.status(404).json({ error: 'User not found or registration expired' });
          return;
        }
        
        const token = jwt.sign({ id: existingUser.id, role: existingUser.role }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({ token, user: existingUser });
        return;
      }

      const pendingReg = JSON.parse(pendingRegStr);
      
      const [newUser] = await db('users').insert({
        name: pendingReg.name,
        phone: pendingReg.phone,
        role: pendingReg.role
      }).returning('*');

      const wallet = ethers.Wallet.createRandom();
      const walletAddress = wallet.address;

      if (pendingReg.role === 'tenant') {
        await db('tenants').insert({
          user_id: newUser.id,
          property_id: pendingReg.propertyId,
          status: 'CONNECTED'
        });

        await registerTenantWallet(phone, walletAddress, pendingReg.propertyCode);

        await notificationService.notifyLandlord(pendingReg.propertyId, newUser.name);
      } else {
        await registerLandlordWallet(phone, walletAddress);
      }

      await db('users')
        .where({ id: newUser.id })
        .update({ wallet_address: walletAddress });

      await redis.del(`reg:${phone}`);

      const token = jwt.sign({ id: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({ token, user: { ...newUser, wallet_address: walletAddress } });
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
