import { Request, Response } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import { redis } from '../redis';
import { db } from '../db';
import { otpService } from '../services/otpService';
import { getTokenBalance, registerLandlordWallet, registerTenantWallet } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

const JWT_SECRET = process.env.JWT_SECRET || 'gridee_fallback_secret_key_2026';
const LANDLORD_SHARE_BPS = parseInt(process.env.LANDLORD_SHARE_BPS || '1800', 10);

export const botController = {

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

      const [newUser] = await db('users').insert({ phone, role, name: 'New User' }).returning('*');
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

  async sendOtp(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.body);
      process.stdout.write(`\n[BACKEND] Received OTP request for ${phone}\n`);
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

  async validatePropertyCode(req: Request, res: Response): Promise<void> {
    try {
      const code = String(req.params.code || '').toUpperCase();
      if (!code) {
        res.status(400).json({ valid: false, error: 'Property code is required' });
        return;
      }

      const property = await db('properties')
        .where({ code })
        .where({ status: 'ACTIVE' })
        .first();

      res.status(200).json({ 
        valid: !!property,
        property: property ? {
          code: property.code,
          label: property.label,
          address: property.address
        } : null
      });
    } catch (error: any) {
      console.error('[bot/properties/validate] error:', error);
      res.status(500).json({ valid: false, error: 'Validation failed' });
    }
  },

  async getHelp(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const user = await db('users').where({ phone }).first();

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.status(200).json({ role: user.role });
    } catch (error: any) {
      console.error('[bot/help] error:', error);
      res.status(500).json({ error: 'Failed to fetch help context' });
    }
  },

  async registerTenant(req: Request, res: Response): Promise<void> {
    try {
      const { phone, name, verificationPhone, propertyCode } = z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
        verificationPhone: z.string().min(7),
        propertyCode: z.string().min(3),
      }).parse(req.body);

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

      // Check if user already exists (by WhatsApp phone or verification phone)
      let user = await db('users').where({ phone: verificationPhone }).first();

      if (!user) {
        // Look for the shell user created during onboarding
        user = await db('users').where({ phone }).first();
      }

      if (user && user.role === 'tenant' && user.name !== 'New User') {
        res.status(409).json({ success: false, error: 'User already registered' });
        return;
      }

      if (user) {
        // Update existing shell user or user found by verification phone
        const [updatedUser] = await db('users')
          .where({ id: user.id })
          .update({
            name,
            role: 'tenant',
          })
          .returning('*');
        user = updatedUser;
      } else {
        // Create new user
        const [newUser] = await db('users').insert({
          name,
          phone: verificationPhone,
          role: 'tenant',
        }).returning('*');
        user = newUser;
      }

      await db('tenants').insert({
        user_id: user.id,
        property_id: property.id,
        status: 'CONNECTED',
      });

      // Assign custodial wallet
      const walletAddress = ethers.Wallet.createRandom().address;
      try {
        // Run blockchain call in the background without awaiting so it never blocks the demo
        registerTenantWallet(verificationPhone, walletAddress, property.code).catch((chainError: any) => {
          console.error('[bot/tenants/register] background registerTenantWallet failed:', chainError);
        });
      } catch (e) { }
      await db('users').where({ id: user.id }).update({ wallet_address: walletAddress });

      // Notify landlord
      try {
        await notificationService.notifyLandlord(property.id, name);
      } catch (notifyError) {
        console.error('[bot/tenants/register] landlord notification failed:', notifyError);
      }

      const token = jwt.sign({ id: user.id, role: 'tenant' }, JWT_SECRET, { expiresIn: '7d' });

      res.status(201).json({
        success: true,
        token,
        tenant: { ...user, wallet_address: walletAddress },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, errors: error.issues });
        return;
      }
      res.status(500).json({ success: false, error: 'Registration failed' });
    }
  },

  async registerLandlord(req: Request, res: Response): Promise<void> {
    try {
      const { phone, name, verificationPhone } = z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
        verificationPhone: z.string().min(7),
      }).parse(req.body);

      const existingUser = await db('users').where({ phone: verificationPhone }).first();
      if (existingUser && existingUser.name !== 'New User') {
        res.status(409).json({ success: false, error: 'User already registered' });
        return;
      }

      let newUser;
      if (existingUser) {
        [newUser] = await db('users')
          .where({ id: existingUser.id })
          .update({
            name,
            role: 'landlord',
          })
          .returning('*');
      } else {
        [newUser] = await db('users').insert({
          name,
          phone: phone,
          role: 'landlord',
        }).returning('*');
      }

      // Assign custodial wallet
      const walletAddress = '0x' + Math.random().toString(16).slice(2, 42).padEnd(40, '0');
      try {
        // Run blockchain call in the background without awaiting so it never blocks the demo
        registerLandlordWallet(verificationPhone, walletAddress).catch((chainError: any) => {
          console.error('[bot/landlords/register] background registerLandlordWallet failed:', chainError);
        });
      } catch (e) { }
      await db('users').where({ id: newUser.id }).update({ wallet_address: walletAddress });

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

      const balanceGrd = await getTokenBalance(user.wallet_address || '');

      // Calculate hours remaining (MVP: use fixed rate from .env)
      const consumptionRate = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');
      const hoursLeft = Math.floor(parseFloat(balanceGrd) / consumptionRate);

      const lastTx = await db('transactions')
        .where({ tenant_id: tenant.id, status: 'SUCCESSFUL' })
        .orderBy('created_at', 'desc')
        .first();

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

  async getTenantProperty(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const user = await db('users').where({ phone, role: 'tenant' }).first();

      if (!user) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      const tenantRecord = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .join('users as landlords', 'properties.landlord_id', 'landlords.id')
        .where({ 'tenants.user_id': user.id })
        .select(
          'properties.label',
          'properties.address',
          'landlords.name as landlordName',
          'tenants.status'
        )
        .first();

      if (!tenantRecord) {
        res.status(404).json({ error: 'Property link not found' });
        return;
      }

      res.status(200).json({
        label: tenantRecord.label,
        address: tenantRecord.address,
        landlordName: tenantRecord.landlordName,
        status: tenantRecord.status === 'CONNECTED' ? 'Connected' : 'Disconnected'
      });
    } catch (error: any) {
      console.error('[bot/tenants/property] error:', error);
      res.status(500).json({ error: 'Failed to fetch property details' });
    }
  },

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
            flatCount: p.flat_count,
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
        flatCount: property.flat_count,
        activeTenantCount: Number(tenantCount?.count || 0)
      });
    } catch (error: any) {
      console.error('[bot/landlord/property/details] error:', error);
      res.status(500).json({ error: 'Failed to fetch property details' });
    }
  },

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

      const formattedTenants = tenants.map(t => ({
        ...t,
        flatNumber: '' // Currently not in schema
      }));

      res.status(200).json({ tenants: formattedTenants });
    } catch (error: any) {
      console.error('[bot/landlord/property/tenants] error:', error);
      res.status(500).json({ error: 'Failed to fetch tenants' });
    }
  },

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
        .join('tenants', 'transactions.tenant_id', 'tenants.id')
        .whereIn('tenants.property_id', propertyIds)
        .where({ 'transactions.status': 'SUCCESSFUL' })
        .select('tenants.property_id')
        .sum('transactions.amount_ngn as total')
        .groupBy('tenants.property_id');

      const shareMultiplier = LANDLORD_SHARE_BPS / 10000;

      const breakdown = properties.map(p => {
        const pEarnings = earnings.find(e => e.property_id === p.id);
        return {
          code: p.code,
          label: p.label,
          amount: Math.round((Number(pEarnings?.total || 0) * shareMultiplier) * 100) / 100
        };
      });

      const totalEarned = breakdown.reduce((sum, item) => sum + item.amount, 0);

      const withdrawals = await db('withdrawals')
        .where({ landlord_id: user.id })
        .whereIn('status', ['PENDING', 'SUCCESSFUL'])
        .sum('amount as total')
        .first();
      const totalWithdrawn = Number(withdrawals?.total || 0);
      const totalAvailable = Math.max(0, Math.round((totalEarned - totalWithdrawn) * 100) / 100);

      res.status(200).json({ total: totalAvailable, breakdown });
    } catch (error: any) {
      console.error('[bot/landlords/earnings] error:', error);
      res.status(500).json({ error: 'Failed to fetch earnings' });
    }
  },

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
        .join('tenants', 'transactions.tenant_id', 'tenants.id')
        .where({ 'tenants.property_id': property.id, 'transactions.status': 'SUCCESSFUL' })
        .sum('transactions.amount_ngn as total')
        .count('transactions.id as count')
        .first();

      const shareMultiplier = LANDLORD_SHARE_BPS / 10000;
      const amount = Math.round((Number(earnings?.total || 0) * shareMultiplier) * 100) / 100;

      res.status(200).json({
        code,
        amount,
        purchaseCount: Number(earnings?.count || 0)
      });
    } catch (error: any) {
      console.error('[bot/landlords/property/earnings] error:', error);
      res.status(500).json({ error: 'Failed to fetch property earnings' });
    }
  },


  async getBankDetails(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Check if user has bank details
      res.status(200).json({
        bankName: user.bank_name || null,
        accountNumber: user.account_number || null
      });
    } catch (error: any) {
      console.error('[bot/landlord/bank-details/get] error:', error);
      res.status(500).json({ error: 'Failed to fetch bank details' });
    }
  },

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
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }
      console.error('[bot/landlord/bank-details/save] error:', error);
      res.status(500).json({ error: error.message || 'Failed to save bank details' });
    }
  },

  async initiateWithdrawal(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { amount } = z.object({ amount: z.number().min(0) }).parse(req.body);

      if (amount <= 0) {
        res.status(400).json({ error: 'Withdrawal amount must be greater than zero' });
        return;
      }

      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      if (!landlord.account_number) {
        res.status(400).json({ error: 'Bank details missing. Save bank details first.' });
        return;
      }

      const [withdrawal] = await db('withdrawals').insert({
        landlord_id: landlord.id,
        amount,
        bank_name: landlord.bank_name,
        account_number: landlord.account_number,
        status: 'PENDING'
      }).returning('*');

      res.status(201).json({
        success: true,
        amount,
        bankName: landlord.bank_name,
        bankLast4: landlord.account_number.slice(-4)
      });
    } catch (error: any) {
      console.error('[bot/landlord/withdraw] error:', error);
      res.status(500).json({ error: 'Failed to initiate withdrawal' });
    }
  },

  async removeTenant(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { tenantPhone } = z.object({ tenantPhone: z.string().min(7) }).parse(req.body);

      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      const tenantUser = await db('users').where({ phone: tenantPhone, role: 'tenant' }).first();
      if (!tenantUser) {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      const tenantRecord = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .where({
          'tenants.user_id': tenantUser.id,
          'properties.landlord_id': landlord.id
        })
        .select('tenants.id', 'properties.label as propertyLabel')
        .first();

      if (!tenantRecord) {
        res.status(403).json({ error: 'Tenant not registered under your properties' });
        return;
      }

      await db('tenants').where({ id: tenantRecord.id }).update({ status: 'DISCONNECTED' });

      res.status(200).json({
        success: true,
        tenantName: tenantUser.name,
        propertyName: tenantRecord.propertyLabel
      });
    } catch (error: any) {
      console.error('[bot/landlord/remove-tenant] error:', error);
      res.status(500).json({ error: 'Failed to remove tenant' });
    }
  },

  async getSession(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const data = await redis.get(`bot_session:${phone}`);
      res.status(200).json({ session: data ? JSON.parse(data) : null });
    } catch (error: any) {
      console.error('[bot/session/get] error:', error);
      res.status(500).json({ error: 'Failed to fetch session' });
    }
  },

  async updateSession(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { step, data } = z.object({
        step: z.string(),
        data: z.record(z.string(), z.any()).optional()
      }).parse(req.body);

      const existingStr = await redis.get(`bot_session:${phone}`);
      const existing = existingStr ? JSON.parse(existingStr) : { data: {} };

      const newSession = {
        step,
        data: { ...existing.data, ...(data || {}) }
      };

      await redis.set(`bot_session:${phone}`, JSON.stringify(newSession), 'EX', 3600);
      res.status(200).json({ success: true, session: newSession });
    } catch (error: any) {
      console.error('[bot/session/update] error:', error);
      res.status(500).json({ error: 'Failed to update session' });
    }
  },

  async clearSession(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      await redis.del(`bot_session:${phone}`);
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error('[bot/session/clear] error:', error);
      res.status(500).json({ error: 'Failed to clear session' });
    }
  },

  async createProperty(req: Request, res: Response): Promise<void> {
    try {
      const { phone, address, flatCount, label } = z.object({
        phone: z.string().min(7),
        address: z.string().min(5),
        flatCount: z.number().int().positive(),
        label: z.string().min(2),
      }).parse(req.body);

      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      // Generate a unique Property Code (GRD-LAG-0042 style)
      let isUnique = false;
      let code = '';
      // Extract state abbreviation from address (first 3 letters of last word, default LAG)
      const stateWords = address.split(',').map((s: string) => s.trim()).filter(Boolean);
      const stateAbbr = (stateWords[stateWords.length - 1] || 'LAG').replace(/\s+state$/i, '').substring(0, 3).toUpperCase();
      while (!isUnique) {
        const seq = String(Math.floor(Math.random() * 9000) + 1000);
        code = `GRD-${stateAbbr}-${seq}`;
        const existing = await db('properties').where({ code }).first();
        if (!existing) isUnique = true;
      }

      const [property] = await db('properties').insert({
        landlord_id: landlord.id,
        code,
        label,
        address,
        flat_count: flatCount,
        status: 'ACTIVE'
      }).returning('*');

      res.status(201).json({
        success: true,
        code: property.code,
        label: property.label
      });
    } catch (error: any) {
      console.error('[bot/properties/create] error:', error);
      res.status(500).json({ error: 'Failed to create property' });
    }
  },
  async createPaymentIntent(req: Request, res: Response): Promise<void> {
    try {
      const { tenantPhone, amountNaira, paymentMethod, propertyCode } = z.object({
        tenantPhone: z.string().min(7),
        amountNaira: z.number().positive(),
        paymentMethod: z.enum(['bank_transfer', 'mobile_money', 'crypto']),
        propertyCode: z.string().optional(),
      }).parse(req.body);

      const user = await db('users').where({ phone: tenantPhone }).first();
      if (!user || user.role !== 'tenant') {
        res.status(404).json({ error: 'Tenant not found' });
        return;
      }

      // Sync property if provided
      if (propertyCode) {
        const property = await db('properties').where({ code: propertyCode.toUpperCase() }).first();
        if (property) {
          await db('tenants')
            .where({ user_id: user.id })
            .update({ property_id: property.id });
        }
      }

      const grdPrice = parseFloat(process.env.GRD_PRICE_PER_NGN || '1');
      const grdAmount = amountNaira * grdPrice;
      const reference = `GRD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const tenant = await db('tenants').where({ user_id: user.id }).first();

      const [transaction] = await db('transactions').insert({
        tenant_id: tenant?.id,
        amount_ngn: amountNaira,
        grd_amount: grdAmount,
        payment_method: paymentMethod,
        payment_ref: reference,
        status: 'PENDING'
      }).returning('*');

      // Mocked payment instructions based on method
      let paymentData: any = { reference, amountNaira, grdAmount };

      if (paymentMethod === 'bank_transfer') {
        paymentData = {
          ...paymentData,
          accountNumber: '0123456789',
          bankName: 'Wema Bank',
          accountName: 'Gridee Energy'
        };
      } else if (paymentMethod === 'mobile_money') {
        paymentData = {
          ...paymentData,
          network: 'OPay'
        };
      } else {
        paymentData = {
          ...paymentData,
          walletAddress: '0x1234567890abcdef1234567890abcdef12345678'
        };
      }

      res.status(200).json({ payment: paymentData });

      // AUTO-CONFIRM for Demo Mode
      if (process.env.MOCK_BLOCKCHAIN === 'true') {
        const webhookUrl = `http://127.0.0.1:${process.env.PORT || 3000}/api/payments/webhook`;
        const webhookHash = process.env.FLUTTERWAVE_WEBHOOK_HASH || 'gridee_webhook_secret_2026';

        console.log(`\x1b[33m[DEMO MODE]\x1b[0m Scheduling auto-confirm for ${reference} in 15 seconds...`);

        setTimeout(async () => {
          try {
            await axios.post(webhookUrl, {
              tx_ref: reference,
              status: 'successful',
              amount: amountNaira
            }, {
              headers: { 'verif-hash': webhookHash }
            });
            console.log(`\x1b[32m[DEMO MODE]\x1b[0m Auto-confirmed ${reference}`);
          } catch (err: any) {
            console.error(`\x1b[31m[DEMO MODE]\x1b[0m Auto-confirm failed for ${reference}:`, err.message);
          }
        }, 15000);
      }
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
        return;
      }
      console.error('[bot/payments/intents] error:', error);
      res.status(500).json({ error: 'Failed to create payment intent' });
    }
  },
};
