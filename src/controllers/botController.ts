import { Request, Response } from 'express';
import { z } from 'zod';
import { redis } from '../redis';
import { db } from '../db';
import { otpService } from '../services/otpService';
import { assignWallet, getTokenBalance } from '../services/contractService';
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
   * POST /bot/users/resolve
   * Body: { phone }
   * Looks up an existing user by phone number.
   * Returns { user } or { user: null } if not found.
   * Called by the bot-router on every inbound message to determine session context.
   */
  async resolveUser(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.body);
      const user = await db('users').where({ phone }).first() ?? null;
      res.status(200).json({ user });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/users/resolve] error:', error);
      res.status(500).json({ error: 'Failed to resolve user' });
    }
  },

  /**
   * PATCH /bot/users/role
   * Body: { phone, role }
   * Pre-assigns a role ('landlord' | 'tenant') before registration begins.
   * Creates a placeholder user record if one doesn't yet exist.
   * Returns { user }
   */
  async setUserRole(req: Request, res: Response): Promise<void> {
    try {
      const { phone, role } = z.object({
        phone: z.string().min(7),
        role: z.enum(['landlord', 'tenant']),
      }).parse(req.body);

      const existing = await db('users').where({ phone }).first();
      if (existing) {
        const [updated] = await db('users').where({ phone }).update({ role }).returning('*');
        res.status(200).json({ user: updated });
        return;
      }

      // No record yet — create a shell user so the session can proceed
      const [newUser] = await db('users').insert({ phone, role, name: null }).returning('*');
      res.status(200).json({ user: newUser });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/users/role] error:', error);
      res.status(500).json({ error: 'Failed to set user role' });
    }
  },

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
      await assignWallet(newUser.id, '');
      const walletAddress = '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0'); // Temporary mock for DB until wallet generation is clear
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
      res.status(500).json({ success: false, error: 'Registration failed' });
    }
  },
  
  /**
   * GET /bot/tenants/:phone/balance
   * Returns current GRD balance, hours remaining, and property info.
   */
  async getTenantBalance(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      
      const user = await db('users').where({ phone }).first();
      if (!user || user.role !== 'tenant') {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      const tenant = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .where({ 'tenants.user_id': user.id })
        .select('tenants.*', 'properties.label as propertyLabel')
        .first();

      if (!tenant) {
        res.status(404).json({ error: 'Tenant property link not found' });
        return;
      }

      // Fetch on-chain balance
      const balanceGrd = await getTokenBalance(user.wallet_address || '');
      
      // Calculate hours remaining (MVP: use fixed rate from .env)
      const consumptionRate = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');
      const hoursLeft = Math.floor(parseFloat(balanceGrd) / consumptionRate);

      // Get last successful topup date
      const lastTx = await db('transactions')
        .where({ tenant_id: tenant.id, status: 'SUCCESSFUL' })
        .orderBy('created_at', 'desc')
        .first();

      // Calculate NGN equivalent
      const grdPrice = parseFloat(process.env.GRD_PRICE_PER_NGN || '1');
      const balanceNGN = parseFloat(balanceGrd) / grdPrice;

      res.status(200).json({
        balanceGrd: parseFloat(balanceGrd),
        balanceNGN: Math.round(balanceNGN * 100) / 100,
        estimatedHours: hoursLeft,
        propertyName: tenant.propertyLabel,
        lastTopupDate: lastTx ? new Date(lastTx.created_at).toLocaleDateString('en-GB') : 'Never',
        status: tenant.status === 'CONNECTED' ? 'Connected' : 'Disconnected'
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/tenants/balance] error:', error);
      res.status(500).json({ error: 'Failed to fetch balance' });
    }
  },

  /**
   * GET /bot/tenants/:phone/history
   * Returns last 10 transactions for the tenant.
   */
  async getTenantHistory(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      
      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const tenant = await db('tenants').where({ user_id: user.id }).first();
      if (!tenant) {
        res.status(404).json({ error: 'Tenant record not found' });
        return;
      }

      const transactions = await db('transactions')
        .where({ tenant_id: tenant.id })
        .orderBy('created_at', 'desc')
        .limit(10);

      const formattedTransactions = transactions.map((tx: any) => ({
        date: new Date(tx.created_at).toLocaleDateString('en-GB'),
        amountNaira: Number(tx.amount_ngn),
        grdAmount: Number(tx.grd_amount)
      }));

      res.status(200).json({ transactions: formattedTransactions });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/tenants/history] error:', error);
      res.status(500).json({ error: 'Failed to fetch history' });
    }
  }
};
