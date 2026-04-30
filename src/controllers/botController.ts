import { Request, Response } from 'express';
import { z } from 'zod';
import { redis } from '../redis';
import { db } from '../db';
import { otpService } from '../services/otpService';
import { contractService } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;

/**
 * Bot-facing controller.
 * These endpoints are consumed exclusively by the gridee-bot WhatsApp client.
 * Endpoint shapes must match src/backend/http-backend-client.js in gridee-bot.
 */
export const botController = {

  /**
   * POST /bot/otp/send
   * Body: { phone, purpose }
   * Sends an OTP to the given phone number.
   */
  async sendOtp(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.body);
      await otpService.sendOTP(phone);
      res.status(200).json({ sent: true });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/otp/send] error:', error);
      res.status(500).json({ error: 'Failed to send OTP' });
    }
  },

  /**
   * POST /bot/otp/verify
   * Body: { phone, code, purpose }
   * Returns { valid: true/false }
   */
  async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = z.object({
        phone: z.string().min(7),
        code: z.string().length(6),
      }).parse(req.body);

      const valid = await otpService.verifyOTP(phone, code);
      res.status(200).json({ valid });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/otp/verify] error:', error);
      res.status(500).json({ error: 'OTP verification failed' });
    }
  },

  /**
   * GET /bot/properties/:code/validate
   * Validates that a property code exists and is active.
   * Returns { valid: true/false }
   */
  async validatePropertyCode(req: Request, res: Response): Promise<void> {
    try {
      const code = String(req.params.code || '').toUpperCase();
      if (!code) {
        res.status(400).json({ valid: false, error: 'Property code is required' });
        return;
      }

      const property = await db('properties')
        .where({ code })
        .whereIn('status', ['ACTIVE', 'active'])
        .first();

      res.status(200).json({ valid: !!property });
    } catch (error: any) {
      console.error('[bot/properties/validate] error:', error);
      res.status(500).json({ valid: false, error: 'Validation failed' });
    }
  },

  /**
   * POST /bot/tenants/register
   * Body: { phone, name, verificationPhone, propertyCode }
   * Creates user + tenant record, assigns wallet, notifies landlord.
   * Returns { tenant: { name, phone, ... } }
   */
  async registerTenant(req: Request, res: Response): Promise<void> {
    try {
      const { phone, name, verificationPhone, propertyCode } = z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
        verificationPhone: z.string().min(7),
        propertyCode: z.string().min(3),
      }).parse(req.body);

      // Find the property
      const property = await db('properties')
        .where({ code: propertyCode.toUpperCase() })
        .first();

      if (!property) {
        res.status(404).json({
          success: false,
          error: "That Property Code wasn't found. Please check with your landlord and try again.",
        });
        return;
      }

      // Check if user already exists
      const existingUser = await db('users').where({ phone: verificationPhone }).first();
      if (existingUser) {
        res.status(409).json({ success: false, error: 'User already registered' });
        return;
      }

      // Create user
      const [newUser] = await db('users').insert({
        name,
        phone: verificationPhone,
        role: 'tenant',
      }).returning('*');

      // Link tenant to property
      await db('tenants').insert({
        user_id: newUser.id,
        property_id: property.id,
        status: 'CONNECTED',
      });

      // Assign custodial wallet
      const walletAddress = await contractService.assignWallet(newUser.id);
      await db('users').where({ id: newUser.id }).update({ wallet_address: walletAddress });

      // Notify landlord (WhatsApp first, SMS fallback)
      await notificationService.notifyLandlord(property.id, name);

      // Sign JWT
      const token = jwt.sign({ id: newUser.id, role: 'tenant' }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({
        success: true,
        token,
        tenant: { ...newUser, wallet_address: walletAddress },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, errors: error.issues });
        return;
      }
      console.error('[bot/tenants/register] error:', error);
      res.status(500).json({ success: false, error: 'Registration failed' });
    }
  },
};
