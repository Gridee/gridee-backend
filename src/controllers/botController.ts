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
   * POST /bot/properties
   * Body: { phone, address, flatCount, label }
   */
  async createProperty(req: Request, res: Response): Promise<void> {
    try {
      const { phone, address, flatCount, label } = z.object({
        phone: z.string().min(7),
        address: z.string().min(5),
        flatCount: z.number().int().positive(),
        label: z.string().min(2),
      }).parse(req.body);

      const user = await db('users').where({ phone, role: 'landlord' }).first();
      if (!user) {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      // Generate property code: GRD-{STATE}-{sequence}
      // For MVP, we'll use LAG (Lagos) and a random 4-digit number or sequence
      const sequence = Math.floor(1000 + Math.random() * 9000);
      const code = `GRD-LAG-${sequence}`;

      const [property] = await db('properties').insert({
        landlord_id: user.id,
        code,
        label,
        address,
        flat_count: flatCount,
        status: 'ACTIVE'
      }).returning('*');

      res.status(201).json({ property });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/properties/create] error:', error);
      res.status(500).json({ error: 'Failed to create property' });
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
   * POST /bot/landlords/register
   * Body: { phone, name, verificationPhone }
   */
  async registerLandlord(req: Request, res: Response): Promise<void> {
    try {
      const { phone, name, verificationPhone } = z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
        verificationPhone: z.string().min(7),
      }).parse(req.body);

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
        role: 'landlord',
      }).returning('*');

      // Assign custodial wallet
      await assignWallet(newUser.id, '');
      const walletAddress = '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0'); // Temporary mock for DB until wallet generation is clear
      await db('users').where({ id: newUser.id }).update({ wallet_address: walletAddress });

      // Sign JWT
      const token = jwt.sign({ id: newUser.id, role: 'landlord' }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({
        success: true,
        token,
        user: { ...newUser, wallet_address: walletAddress },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, errors: error.issues });
        return;
      }
      console.error('[bot/landlords/register] error:', error);
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
  },

  /**
   * GET /bot/landlord/:phone/properties
   */
  async getLandlordProperties(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const user = await db('users').where({ phone }).first();
      if (!user || user.role !== 'landlord') {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      const properties = await db('properties')
        .where({ landlord_id: user.id })
        .select('properties.*')
        .orderBy('created_at', 'desc');

      const enhancedProperties = await Promise.all(
        properties.map(async (p) => {
          const tenantCount = await db('tenants').where({ property_id: p.id }).count('id as count').first();
          return {
            ...p,
            activeTenantCount: Number(tenantCount?.count || 0)
          };
        })
      );

      res.status(200).json({ properties: enhancedProperties });
    } catch (error: any) {
      console.error('[bot/landlord/properties] error:', error);
      res.status(500).json({ error: 'Failed to fetch properties' });
    }
  },

  /**
   * GET /bot/landlord/:phone/properties/:code
   */
  async getLandlordPropertyDetails(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = z.object({
        phone: z.string().min(7),
        code: z.string()
      }).parse({ ...req.params });

      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const property = await db('properties').where({ landlord_id: user.id, code }).first();
      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }

      const tenantCount = await db('tenants').where({ property_id: property.id }).count('id as count').first();

      res.status(200).json({
        ...property,
        activeTenantCount: Number(tenantCount?.count || 0)
      });
    } catch (error: any) {
      console.error('[bot/landlord/property/details] error:', error);
      res.status(500).json({ error: 'Failed to fetch property details' });
    }
  },

  /**
   * GET /bot/landlord/:phone/properties/:code/tenants
   */
  async getLandlordPropertyTenants(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = z.object({
        phone: z.string().min(7),
        code: z.string()
      }).parse({ ...req.params });

      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const property = await db('properties').where({ landlord_id: user.id, code }).first();
      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }

      const tenants = await db('tenants')
        .join('users', 'tenants.user_id', 'users.id')
        .where({ 'tenants.property_id': property.id })
        .select('users.name', 'users.phone', 'tenants.status');

      res.status(200).json({ tenants });
    } catch (error: any) {
      console.error('[bot/landlord/property/tenants] error:', error);
      res.status(500).json({ error: 'Failed to fetch tenants' });
    }
  },

  /**
   * GET /bot/landlord/:phone/earnings
   */
  async getLandlordEarnings(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const properties = await db('properties').where({ landlord_id: user.id });
      const propertyIds = properties.map(p => p.id);

      const earnings = await db('transactions')
        .whereIn('property_id', propertyIds)
        .where({ status: 'SUCCESSFUL' })
        .select('property_id')
        .sum('amount_ngn as total')
        .groupBy('property_id');

      const breakdown = properties.map(p => {
        const pEarnings = earnings.find(e => e.property_id === p.id);
        return {
          code: p.code,
          label: p.label,
          amount: Math.round((Number(pEarnings?.total || 0) * 0.1) * 100) / 100 // 10% share
        };
      });

      const total = breakdown.reduce((sum, item) => sum + item.amount, 0);

      res.status(200).json({ total, breakdown });
    } catch (error: any) {
      console.error('[bot/landlords/earnings] error:', error);
      res.status(500).json({ error: 'Failed to fetch earnings' });
    }
  },

  /**
   * GET /bot/landlords/:phone/properties/:code/earnings
   */
  async getLandlordPropertyEarnings(req: Request, res: Response): Promise<void> {
    try {
      const { phone, code } = z.object({
        phone: z.string().min(7),
        code: z.string()
      }).parse({ ...req.params });

      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const property = await db('properties').where({ landlord_id: user.id, code }).first();
      if (!property) {
        res.status(404).json({ error: 'Property not found' });
        return;
      }

      const earnings = await db('transactions')
        .where({ property_id: property.id, status: 'SUCCESSFUL' })
        .sum('amount_ngn as total')
        .first();

      const amount = Math.round((Number(earnings?.total || 0) * 0.1) * 100) / 100;

      res.status(200).json({ code, amount });
    } catch (error: any) {
      console.error('[bot/landlords/property/earnings] error:', error);
      res.status(500).json({ error: 'Failed to fetch property earnings' });
    }
  },


  /**
   * GET /bot/landlord/:phone/bank-details
   */
  async getBankDetails(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Check if user has bank details (we might need to add these columns to users table or a separate table)
      // For now, let's assume they are in the users table or we return null
      res.status(200).json({ 
        bankName: user.bank_name || null,
        accountNumber: user.account_number || null
      });
    } catch (error: any) {
      console.error('[bot/landlord/bank-details/get] error:', error);
      res.status(500).json({ error: 'Failed to fetch bank details' });
    }
  },

  /**
   * POST /bot/landlord/:phone/bank-details
   */
  async saveBankDetails(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { bankName, accountNumber } = z.object({
        bankName: z.string(),
        accountNumber: z.string().min(10)
      }).parse(req.body);

      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      await db('users').where({ phone }).update({
        bank_name: bankName,
        account_number: accountNumber
      });

      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('[bot/landlord/bank-details/save] error:', error);
      res.status(500).json({ error: 'Failed to save bank details' });
    }
  },

  /**
   * POST /bot/landlord/:phone/withdraw
   */
  async initiateWithdrawal(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);

      const user = await db('users').where({ phone }).first();
      if (!user || user.role !== 'landlord') {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      if (!user.account_number) {
        res.status(400).json({ error: 'Bank details missing' });
        return;
      }

      // Record withdrawal
      const [withdrawal] = await db('withdrawals').insert({
        landlord_id: user.id,
        amount,
        bank_name: user.bank_name,
        account_number: user.account_number,
        status: 'PENDING'
      }).returning('*');

      res.status(201).json({
        success: true,
        amount,
        bankName: user.bank_name,
        bankLast4: user.account_number.slice(-4)
      });
    } catch (error: any) {
      console.error('[bot/landlord/withdraw] error:', error);
      res.status(500).json({ error: 'Failed to initiate withdrawal' });
    }
  }
};
