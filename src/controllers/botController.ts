import { Request, Response } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import { redis } from '../redis';
import { db } from '../db';
import { otpService } from '../services/otpService';
import { getTokenBalance, registerLandlordWallet, registerTenantWallet } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
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

      res.status(200).json({ valid: !!property });
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

      const existingUser = await db('users').where({ phone: verificationPhone }).first();
      if (existingUser) {
        res.status(409).json({ success: false, error: 'User already registered' });
        return;
      }

      const [newUser] = await db('users').insert({
        name,
        phone: verificationPhone,
        role: 'tenant',
      }).returning('*');

      await db('tenants').insert({
        user_id: newUser.id,
        property_id: property.id,
        status: 'CONNECTED',
      });

      const wallet = ethers.Wallet.createRandom();
      const walletAddress = wallet.address;
      await registerTenantWallet(verificationPhone, walletAddress, property.code);
      await db('users').where({ id: newUser.id }).update({ wallet_address: walletAddress });

      await notificationService.notifyLandlord(property.id, name);

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

  async registerLandlord(req: Request, res: Response): Promise<void> {
    try {
      const { phone, name, verificationPhone } = z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
        verificationPhone: z.string().min(7),
      }).parse(req.body);

      const existingUser = await db('users').where({ phone: verificationPhone }).first();
      if (existingUser) {
        res.status(409).json({ success: false, error: 'User already registered' });
        return;
      }

      const [newUser] = await db('users').insert({
        name,
        phone: verificationPhone,
        role: 'landlord',
      }).returning('*');

      const wallet = ethers.Wallet.createRandom();
      const walletAddress = wallet.address;
      await registerLandlordWallet(verificationPhone, walletAddress);
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

      const tenantCounts = await db('tenants')
        .whereIn('property_id', properties.map(p => p.id))
        .groupBy('property_id')
        .select('property_id')
        .count('id as count');

      const countMap = new Map<number, number>();
      tenantCounts.forEach((row: any) => countMap.set(row.property_id, Number(row.count)));

      const enhancedProperties = properties.map(p => ({
        ...p,
        activeTenantCount: countMap.get(p.id) || 0
      }));

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

      res.status(200).json({ property: { code: property.code, label: property.label, flatCount: property.flat_count, occupiedCount: tenants.length }, tenants });
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
        .whereIn('property_id', propertyIds)
        .where({ status: 'SUCCESSFUL' })
        .select('property_id')
        .sum('amount_ngn as total')
        .groupBy('property_id');

      const shareMultiplier = LANDLORD_SHARE_BPS / 10000;

      const breakdown = properties.map(p => {
        const pEarnings = earnings.find(e => e.property_id === p.id);
        return {
          code: p.code,
          label: p.label,
          amount: Math.round((Number(pEarnings?.total || 0) * shareMultiplier) * 100) / 100
        };
      });

      const total = breakdown.reduce((sum, item) => sum + item.amount, 0);

      res.status(200).json({ total, breakdown });
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
        .where({ property_id: property.id, status: 'SUCCESSFUL' })
        .sum('amount_ngn as total')
        .first();

      const shareMultiplier = LANDLORD_SHARE_BPS / 10000;
      const amount = Math.round((Number(earnings?.total || 0) * shareMultiplier) * 100) / 100;

      res.status(200).json({ code, amount });
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
      console.error('[bot/landlord/bank-details/save] error:', error);
      res.status(500).json({ error: 'Failed to save bank details' });
    }
  },

  async initiateWithdrawal(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);

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

      let isUnique = false;
      let code = '';
      while (!isUnique) {
        code = `GRD-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
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
};
