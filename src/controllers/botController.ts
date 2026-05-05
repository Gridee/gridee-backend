import { Request, Response } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import { redis } from '../redis';
import { db } from '../db';
import { otpService } from '../services/otpService';
import { getTokenBalance, registerLandlordWallet, registerTenantWallet } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import * as jwt from 'jsonwebtoken';
import { withBotHandler } from '../utils/botHandler';

const JWT_SECRET = process.env.JWT_SECRET || 'gridee_fallback_secret_key_2026';
const LANDLORD_SHARE_BPS = parseInt(process.env.LANDLORD_SHARE_BPS || '1800', 10);

export const botController = {

  resolveUser: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }) => {
      const user = await db('users').where({ phone }).first() ?? null;
      return { user };
    }
  ),

  setUserRole: withBotHandler(
    z.object({ phone: z.string().min(7), role: z.enum(['landlord', 'tenant']) }),
    async ({ phone, role }) => {
      const existing = await db('users').where({ phone }).first();
      if (existing) {
        const [updated] = await db('users').where({ phone }).update({ role }).returning('*');
        return { user: updated };
      }
      const [newUser] = await db('users').insert({ phone, role, name: 'New User' }).returning('*');
      return { user: newUser };
    }
  ),

  sendOtp: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }) => {
      await otpService.sendOTP(phone);
      return { sent: true };
    }
  ),

  verifyOtp: withBotHandler(
    z.object({ phone: z.string().min(7), code: z.string().length(6) }),
    async ({ phone, code }) => {
      const valid = await otpService.verifyOTP(phone, code);
      return { valid };
    }
  ),

  validatePropertyCode: withBotHandler(
    null,
    async (_body, req) => {
      const code = String(req.params.code || '').toUpperCase();
      if (!code) {
        throw new Error('Property code is required');
      }
      const property = await db('properties').where({ code }).where({ status: 'ACTIVE' }).first();
      return { valid: !!property };
    }
  ),

  getHelp: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
      }
      return { role: user.role };
    },
    { parseFrom: 'params' }
  ),

  registerTenant: withBotHandler(
    z.object({
      phone: z.string().min(7),
      name: z.string().min(1),
      verificationPhone: z.string().min(7),
      propertyCode: z.string().min(3),
    }),
    async ({ phone, name, verificationPhone, propertyCode }) => {
      const property = await db('properties').where({ code: propertyCode.toUpperCase() }).first();
      if (!property) {
        throw new Error("That Property Code wasn't found. Please check with your landlord and try again.");
      }

      let user = await db('users').where({ phone: verificationPhone }).first();
      if (!user) {
        user = await db('users').where({ phone }).first();
      }

      if (user && user.role === 'tenant' && user.name !== 'New User') {
        throw new Error('User already registered');
      }

      if (user) {
        const [updatedUser] = await db('users').where({ id: user.id }).update({ name, role: 'tenant' }).returning('*');
        user = updatedUser;
      } else {
        const [newUser] = await db('users').insert({ name, phone: verificationPhone, role: 'tenant' }).returning('*');
        user = newUser;
      }

      await db('tenants').insert({ user_id: user.id, property_id: property.id, status: 'CONNECTED' });

      const wallet = ethers.Wallet.createRandom();
      const walletAddress = wallet.address;
      registerTenantWallet(verificationPhone, walletAddress, property.code).catch(() => {});
      await db('users').where({ id: user.id }).update({ wallet_address: walletAddress });

      notificationService.notifyLandlord(property.id, name).catch(() => {});

      const token = jwt.sign({ id: user.id, role: 'tenant' }, JWT_SECRET, { expiresIn: '7d' });

      return { success: true, token, tenant: { ...user, wallet_address: walletAddress } };
    },
    { status: 201 }
  ),

  registerLandlord: withBotHandler(
    z.object({
      phone: z.string().min(7),
      name: z.string().min(1),
      verificationPhone: z.string().min(7),
    }),
    async ({ phone, name, verificationPhone }) => {
      const existingUser = await db('users').where({ phone: verificationPhone }).first();
      if (existingUser && existingUser.name !== 'New User') {
        throw new Error('User already registered');
      }

      let newUser;
      if (existingUser) {
        [newUser] = await db('users').where({ id: existingUser.id }).update({ name, role: 'landlord' }).returning('*');
      } else {
        [newUser] = await db('users').insert({ name, phone, role: 'landlord' }).returning('*');
      }

      const wallet = ethers.Wallet.createRandom();
      const walletAddress = wallet.address;
      registerLandlordWallet(verificationPhone, walletAddress).catch(() => {});
      await db('users').where({ id: newUser.id }).update({ wallet_address: walletAddress });

      const token = jwt.sign({ id: newUser.id, role: 'landlord' }, JWT_SECRET, { expiresIn: '7d' });

      return { success: true, token, user: { ...newUser, wallet_address: walletAddress } };
    },
    { status: 201 }
  ),

  getTenantBalance: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user || user.role !== 'tenant') {
        throw new Error('Tenant not found');
      }

      const tenant = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .where({ 'tenants.user_id': user.id })
        .select('tenants.*', 'properties.label as propertyLabel')
        .first();

      if (!tenant) {
        throw new Error('Tenant property link not found');
      }

      const balanceGrd = await getTokenBalance(user.wallet_address || '');

      const consumptionRate = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');
      const hoursLeft = Math.floor(parseFloat(balanceGrd) / consumptionRate);

      const lastTx = await db('transactions').where({ tenant_id: tenant.id, status: 'SUCCESSFUL' }).orderBy('created_at', 'desc').first();

      const grdPrice = parseFloat(process.env.GRD_PRICE_PER_NGN || '1');
      const balanceNGN = parseFloat(balanceGrd) / grdPrice;

      return {
        balanceGrd: parseFloat(balanceGrd),
        balanceNGN: Math.round(balanceNGN * 100) / 100,
        estimatedHours: hoursLeft,
        propertyName: tenant.propertyLabel,
        lastTopupDate: lastTx ? new Date(lastTx.created_at).toLocaleDateString('en-GB') : 'Never',
        status: tenant.status === 'CONNECTED' ? 'Connected' : 'Disconnected',
      };
    },
    { parseFrom: 'params' }
  ),

  getTenantHistory: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
      }

      const tenant = await db('tenants').where({ user_id: user.id }).first();
      if (!tenant) {
        throw new Error('Tenant record not found');
      }

      const transactions = await db('transactions').where({ tenant_id: tenant.id }).orderBy('created_at', 'desc').limit(10);

      const formattedTransactions = transactions.map((tx: any) => ({
        date: new Date(tx.created_at).toLocaleDateString('en-GB'),
        amountNaira: Number(tx.amount_ngn),
        grdAmount: Number(tx.grd_amount),
      }));

      return { transactions: formattedTransactions };
    },
    { parseFrom: 'params' }
  ),

  getTenantProperty: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const user = await db('users').where({ phone, role: 'tenant' }).first();
      if (!user) {
        throw new Error('Tenant not found');
      }

      const tenantRecord = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .join('users as landlords', 'properties.landlord_id', 'landlords.id')
        .where({ 'tenants.user_id': user.id })
        .select('properties.label', 'properties.address', 'landlords.name as landlordName', 'tenants.status')
        .first();

      if (!tenantRecord) {
        throw new Error('Property link not found');
      }

      return {
        label: tenantRecord.label,
        address: tenantRecord.address,
        landlordName: tenantRecord.landlordName,
        status: tenantRecord.status === 'CONNECTED' ? 'Connected' : 'Disconnected',
      };
    },
    { parseFrom: 'params' }
  ),

  getLandlordProperties: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user || user.role !== 'landlord') {
        throw new Error('Landlord not found');
      }

      const properties = await db('properties').where({ landlord_id: user.id }).select('properties.*').orderBy('created_at', 'desc');

      const enhancedProperties = await Promise.all(
        properties.map(async (p) => {
          const tenantCount = await db('tenants').where({ property_id: p.id }).count('id as count').first();
          return { ...p, flatCount: p.flat_count, activeTenantCount: Number(tenantCount?.count || 0) };
        })
      );

      return { properties: enhancedProperties };
    },
    { parseFrom: 'params' }
  ),

  getLandlordPropertyDetails: withBotHandler(
    z.object({ phone: z.string().min(7), code: z.string() }),
    async ({ phone, code }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
      }

      const property = await db('properties').where({ landlord_id: user.id, code }).first();
      if (!property) {
        throw new Error('Property not found');
      }

      const tenantCount = await db('tenants').where({ property_id: property.id }).count('id as count').first();

      return { ...property, flatCount: property.flat_count, activeTenantCount: Number(tenantCount?.count || 0) };
    },
    { parseFrom: 'params' }
  ),

  getLandlordPropertyTenants: withBotHandler(
    z.object({ phone: z.string().min(7), code: z.string() }),
    async ({ phone, code }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
      }

      const property = await db('properties').where({ landlord_id: user.id, code }).first();
      if (!property) {
        throw new Error('Property not found');
      }

      const tenants = await db('tenants')
        .join('users', 'tenants.user_id', 'users.id')
        .where({ 'tenants.property_id': property.id })
        .select('users.name', 'users.phone', 'tenants.status');

      const formattedTenants = tenants.map(t => ({ ...t, flatNumber: '' }));

      return { tenants: formattedTenants };
    },
    { parseFrom: 'params' }
  ),

  getLandlordEarnings: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
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
        return { code: p.code, label: p.label, amount: Math.round((Number(pEarnings?.total || 0) * shareMultiplier) * 100) / 100 };
      });

      const total = breakdown.reduce((sum, item) => sum + item.amount, 0);

      return { total, breakdown };
    },
    { parseFrom: 'params' }
  ),

  getLandlordPropertyEarnings: withBotHandler(
    z.object({ phone: z.string().min(7), code: z.string() }),
    async ({ phone, code }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
      }

      const property = await db('properties').where({ landlord_id: user.id, code }).first();
      if (!property) {
        throw new Error('Property not found');
      }

      const earnings = await db('transactions')
        .join('tenants', 'transactions.tenant_id', 'tenants.id')
        .where({ 'tenants.property_id': property.id, 'transactions.status': 'SUCCESSFUL' })
        .sum('transactions.amount_ngn as total')
        .count('transactions.id as count')
        .first();

      const shareMultiplier = LANDLORD_SHARE_BPS / 10000;
      const amount = Math.round((Number(earnings?.total || 0) * shareMultiplier) * 100) / 100;

      return { code, amount, purchaseCount: Number(earnings?.count || 0) };
    },
    { parseFrom: 'params' }
  ),

  getBankDetails: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
      }
      return { bankName: user.bank_name || null, accountNumber: user.account_number || null };
    },
    { parseFrom: 'params' }
  ),

  saveBankDetails: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const { bankName, accountNumber } = z.object({
        bankName: z.string(),
        accountNumber: z.string().min(10),
      }).parse(req.body);

      const user = await db('users').where({ phone }).first();
      if (!user) {
        throw new Error('User not found');
      }

      await db('users').where({ phone }).update({ bank_name: bankName, account_number: accountNumber });

      return { success: true };
    },
    { parseFrom: 'params' }
  ),

  initiateWithdrawal: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const { amount } = z.object({ amount: z.number().min(0) }).parse(req.body);

      if (amount <= 0) {
        throw new Error('Withdrawal amount must be greater than zero');
      }

      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        throw new Error('Landlord not found');
      }

      if (!landlord.account_number) {
        throw new Error('Bank details missing. Save bank details first.');
      }

      const [withdrawal] = await db('withdrawals').insert({
        landlord_id: landlord.id,
        amount,
        bank_name: landlord.bank_name,
        account_number: landlord.account_number,
        status: 'PENDING',
      }).returning('*');

      return { success: true, amount, bankName: landlord.bank_name, bankLast4: landlord.account_number.slice(-4) };
    },
    { parseFrom: 'params', status: 201 }
  ),

  removeTenant: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const { tenantPhone } = z.object({ tenantPhone: z.string().min(7) }).parse(req.body);

      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        throw new Error('Landlord not found');
      }

      const tenantUser = await db('users').where({ phone: tenantPhone, role: 'tenant' }).first();
      if (!tenantUser) {
        throw new Error('Tenant not found');
      }

      const tenantRecord = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .where({ 'tenants.user_id': tenantUser.id, 'properties.landlord_id': landlord.id })
        .select('tenants.id', 'properties.label as propertyLabel')
        .first();

      if (!tenantRecord) {
        throw new Error('Tenant not registered under your properties');
      }

      await db('tenants').where({ id: tenantRecord.id }).update({ status: 'DISCONNECTED' });

      return { success: true, tenantName: tenantUser.name, propertyName: tenantRecord.propertyLabel };
    },
    { parseFrom: 'params' }
  ),

  getSession: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const data = await redis.get(`bot_session:${phone}`);
      return { session: data ? JSON.parse(data) : null };
    },
    { parseFrom: 'params' }
  ),

  updateSession: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      const { step, data } = z.object({
        step: z.string(),
        data: z.record(z.string(), z.any()).optional(),
      }).parse(req.body);

      const existingStr = await redis.get(`bot_session:${phone}`);
      const existing = existingStr ? JSON.parse(existingStr) : { data: {} };

      const newSession = { step, data: { ...existing.data, ...(data || {}) } };

      await redis.set(`bot_session:${phone}`, JSON.stringify(newSession), 'EX', 3600);
      return { success: true, session: newSession };
    },
    { parseFrom: 'params' }
  ),

  clearSession: withBotHandler(
    z.object({ phone: z.string().min(7) }),
    async ({ phone }, req) => {
      await redis.del(`bot_session:${phone}`);
      return { success: true };
    },
    { parseFrom: 'params' }
  ),

  createProperty: withBotHandler(
    z.object({
      phone: z.string().min(7),
      address: z.string().min(5),
      flatCount: z.number().int().positive(),
      label: z.string().min(2),
    }),
    async ({ phone, address, flatCount, label }) => {
      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        throw new Error('Landlord not found');
      }

      let isUnique = false;
      let code = '';
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
        status: 'ACTIVE',
      }).returning('*');

      return { success: true, code: property.code, label: property.label };
    },
    { status: 201 }
  ),
};
