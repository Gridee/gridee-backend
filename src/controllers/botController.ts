import { Request, Response } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';
import { redis } from '../redis';
import { db } from '../db';
import { logger } from '../lib/logger';
import { otpService } from '../services/otpService';
import { getTokenBalance, registerLandlordWallet, registerTenantWallet } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET as string;
const LANDLORD_SHARE_BPS = parseInt(process.env.LANDLORD_SHARE_BPS || '1800', 10);
const GRD_PRICE_PER_NGN = parseFloat(process.env.GRD_PRICE_PER_NGN || '1');
const CONSUMPTION_KWH_PER_HOUR = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');

const phoneSchema = z.string().min(7).max(15);
const normalizePhone = (phone: string): string => phone.replace(/[^\d+]/g, '');

type BotError = {
  status: number;
  message: string;
  code?: string;
};

const botError = (status: number, message: string, code?: string): BotError => ({ status, message, code });

const withBotHandler = (
  handler: (req: Request, res: Response) => Promise<void>
) => async (req: Request, res: Response): Promise<void> => {
  try {
    await handler(req, res);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'Validation failed', details: error.issues });
      return;
    }
    const err = error as Error;
    logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Bot handler error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

export const botController = {
  resolveUser: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.body);
    const user = await db('users').where({ phone }).first() ?? null;
    res.status(200).json({ success: true, user });
  }),

  setUserRole: withBotHandler(async (req, res) => {
    const { phone, role } = z.object({
      phone: phoneSchema,
      role: z.enum(['landlord', 'tenant']),
    }).parse(req.body);

    const existing = await db('users').where({ phone }).first();
    if (existing) {
      const [updated] = await db('users').where({ phone }).update({ role }).returning('*');
      res.status(200).json({ success: true, user: updated });
      return;
    }

    const [newUser] = await db('users').insert({ phone, role, name: null }).returning('*');
    res.status(200).json({ success: true, user: newUser });
  }),

  sendOtp: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.body);
    await otpService.sendOTP(phone);
    res.status(200).json({ success: true, sent: true });
  }),

  verifyOtp: withBotHandler(async (req, res) => {
    const { phone, code } = z.object({
      phone: phoneSchema,
      code: z.string().length(6),
    }).parse(req.body);

    const valid = await otpService.verifyOTP(phone, code);
    res.status(200).json({ success: true, valid });
  }),

  validatePropertyCode: withBotHandler(async (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    if (!code) {
      res.status(400).json({ success: false, valid: false, error: 'Property code is required' });
      return;
    }

    const property = await db('properties').where({ code, status: 'ACTIVE' }).first();
    res.status(200).json({ success: true, valid: !!property });
  }),

  getHelp: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const user = await db('users').where({ phone }).first();

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.status(200).json({ success: true, role: user.role });
  }),

  registerTenant: withBotHandler(async (req, res) => {
    const { phone, name, verificationPhone, propertyCode } = z.object({
      phone: phoneSchema,
      name: z.string().min(1).max(100),
      verificationPhone: phoneSchema,
      propertyCode: z.string().min(3).max(20),
    }).parse(req.body);

    const property = await db('properties').where({ code: propertyCode.toUpperCase(), status: 'ACTIVE' }).first();
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

    logger.info({ userId: newUser.id, phone: verificationPhone }, 'Tenant registered');
    res.status(201).json({
      success: true,
      token,
      tenant: { id: newUser.id, name, phone: verificationPhone, wallet_address: walletAddress },
    });
  }),

  registerLandlord: withBotHandler(async (req, res) => {
    const { phone, name, verificationPhone } = z.object({
      phone: phoneSchema,
      name: z.string().min(1).max(100),
      verificationPhone: phoneSchema,
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

    logger.info({ userId: newUser.id, phone: verificationPhone }, 'Landlord registered');
    res.status(201).json({
      success: true,
      token,
      user: { id: newUser.id, name, phone: verificationPhone, wallet_address: walletAddress },
    });
  }),

  initiatePayment: withBotHandler(async (req, res) => {
    const { phone, amountNGN, method } = z.object({
      phone: phoneSchema,
      amountNGN: z.number().positive(),
      method: z.enum(['bank_transfer', 'mobile_money']),
    }).parse(req.body);

    const user = await db('users').where({ phone }).first();
    if (!user || user.role !== 'tenant') {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const grdAmount = amountNGN * GRD_PRICE_PER_NGN;
    const reference = `GRD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const tenant = await db('tenants').where({ user_id: user.id }).first();

    const [transaction] = await db('transactions').insert({
      tenant_id: tenant?.id,
      amount_ngn: amountNGN,
      grd_amount: grdAmount,
      payment_method: method,
      payment_ref: reference,
      status: 'PENDING'
    }).returning('*');

    let response: Record<string, unknown>;
    if (method === 'bank_transfer') {
      response = {
        success: true,
        paymentInstructionsMessage: `Transfer NGN${amountNGN.toLocaleString('en-NG')} to the account below. Use reference: ${reference}`,
        reference,
        accountNumber: '0123456789',
        bankName: 'Wema Bank',
        expiresAt: Date.now() + 15 * 60 * 1000,
        grdAmount,
      };
    } else {
      response = {
        success: true,
        paymentInstructionsMessage: `Send NGN${amountNGN.toLocaleString('en-NG')} via mobile money. Reference: ${reference}`,
        reference,
        network: 'OPay',
        grdAmount,
      };
    }

    logger.info({ transactionId: transaction.id, reference, amountNGN }, 'Payment initiated');
    res.status(200).json(response);
  }),

  getTenantBalance: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);

    const user = await db('users').where({ phone }).first();
    if (!user || user.role !== 'tenant') {
      res.status(404).json({ success: false, error: 'Tenant not found' });
      return;
    }

    const tenant = await db('tenants')
      .join('properties', 'tenants.property_id', 'properties.id')
      .where({ 'tenants.user_id': user.id })
      .select('tenants.*', 'properties.label as propertyLabel')
      .first();

    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant property link not found' });
      return;
    }

    const balanceGrd = await getTokenBalance(user.wallet_address || '');
    const hoursLeft = Math.floor(parseFloat(balanceGrd) / CONSUMPTION_KWH_PER_HOUR);
    const balanceNGN = parseFloat(balanceGrd) / GRD_PRICE_PER_NGN;

    const lastTx = await db('transactions')
      .where({ tenant_id: tenant.id, status: 'SUCCESSFUL' })
      .orderBy('created_at', 'desc')
      .first();

    res.status(200).json({
      success: true,
      balanceGrd: parseFloat(balanceGrd),
      balanceNGN: Math.round(balanceNGN * 100) / 100,
      estimatedHours: hoursLeft,
      propertyName: tenant.propertyLabel,
      lastTopupDate: lastTx ? new Date(lastTx.created_at).toLocaleDateString('en-GB') : 'Never',
      status: tenant.status === 'CONNECTED' ? 'Connected' : 'Disconnected'
    });
  }),

  getTenantHistory: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);

    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const tenant = await db('tenants').where({ user_id: user.id }).first();
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant record not found' });
      return;
    }

    const transactions = await db('transactions')
      .where({ tenant_id: tenant.id })
      .orderBy('created_at', 'desc')
      .limit(10);

    res.status(200).json({
      success: true,
      transactions: transactions.map((tx: any) => ({
        date: new Date(tx.created_at).toLocaleDateString('en-GB'),
        amountNaira: Number(tx.amount_ngn),
        grdAmount: Number(tx.grd_amount)
      }))
    });
  }),

  getTenantProperty: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const user = await db('users').where({ phone, role: 'tenant' }).first();

    if (!user) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
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
      res.status(404).json({ success: false, error: 'Property link not found' });
      return;
    }

    res.status(200).json({
      success: true,
      label: tenantRecord.label,
      address: tenantRecord.address,
      landlordName: tenantRecord.landlordName,
      status: tenantRecord.status === 'CONNECTED' ? 'Connected' : 'Disconnected'
    });
  }),

  getLandlordProperties: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const user = await db('users').where({ phone }).first();
    if (!user || user.role !== 'landlord') {
      res.status(404).json({ success: false, error: 'Landlord not found' });
      return;
    }

    const properties = await db('properties')
      .where({ landlord_id: user.id })
      .select('properties.*')
      .orderBy('created_at', 'desc');

    if (!properties.length) {
      res.status(200).json({ success: true, properties: [] });
      return;
    }

    const tenantCounts = await db('tenants')
      .whereIn('property_id', properties.map(p => p.id))
      .groupBy('property_id')
      .select('property_id')
      .count('id as count');

    const countMap = new Map<number, number>();
    tenantCounts.forEach((row: any) => countMap.set(row.property_id, Number(row.count)));

    res.status(200).json({
      success: true,
      properties: properties.map(p => ({
        ...p,
        activeTenantCount: countMap.get(p.id) || 0
      }))
    });
  }),

  getLandlordPropertyDetails: withBotHandler(async (req, res) => {
    const { phone, code } = z.object({
      phone: phoneSchema,
      code: z.string().min(3).max(20)
    }).parse({ ...req.params });

    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const property = await db('properties').where({ landlord_id: user.id, code }).first();
    if (!property) {
      res.status(404).json({ success: false, error: 'Property not found' });
      return;
    }

    const tenantCount = await db('tenants').where({ property_id: property.id }).count('id as count').first();

    res.status(200).json({
      success: true,
      ...property,
      activeTenantCount: Number(tenantCount?.count || 0)
    });
  }),

  getLandlordPropertyTenants: withBotHandler(async (req, res) => {
    const { phone, code } = z.object({
      phone: phoneSchema,
      code: z.string().min(3).max(20)
    }).parse({ ...req.params });

    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const property = await db('properties').where({ landlord_id: user.id, code }).first();
    if (!property) {
      res.status(404).json({ success: false, error: 'Property not found' });
      return;
    }

    const tenants = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where({ 'tenants.property_id': property.id })
      .select('users.name', 'users.phone', 'tenants.status');

    res.status(200).json({
      success: true,
      property: {
        code: property.code,
        label: property.label,
        flatCount: property.flat_count,
        occupiedCount: tenants.length
      },
      tenants
    });
  }),

  getLandlordEarnings: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const properties = await db('properties').where({ landlord_id: user.id });
    if (!properties.length) {
      res.status(200).json({ success: true, total: 0, breakdown: [] });
      return;
    }

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

    res.status(200).json({ success: true, total, breakdown });
  }),

  getLandlordPropertyEarnings: withBotHandler(async (req, res) => {
    const { phone, code } = z.object({
      phone: phoneSchema,
      code: z.string().min(3).max(20)
    }).parse({ ...req.params });

    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const property = await db('properties').where({ landlord_id: user.id, code }).first();
    if (!property) {
      res.status(404).json({ success: false, error: 'Property not found' });
      return;
    }

    const earnings = await db('transactions')
      .where({ property_id: property.id, status: 'SUCCESSFUL' })
      .sum('amount_ngn as total')
      .first();

    const shareMultiplier = LANDLORD_SHARE_BPS / 10000;
    const amount = Math.round((Number(earnings?.total || 0) * shareMultiplier) * 100) / 100;

    res.status(200).json({ success: true, code, amount });
  }),

  getBankDetails: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      bankName: user.bank_name || null,
      accountNumber: user.account_number || null
    });
  }),

  saveBankDetails: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const { bankName, accountNumber } = z.object({
      bankName: z.string().min(2).max(100),
      accountNumber: z.string().regex(/^\d{10,16}$/)
    }).parse(req.body);

    const user = await db('users').where({ phone }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    await db('users').where({ phone }).update({
      bank_name: bankName,
      account_number: accountNumber
    });

    res.status(200).json({ success: true });
  }),

  initiateWithdrawal: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);

    const landlord = await db('users').where({ phone, role: 'landlord' }).first();
    if (!landlord) {
      res.status(404).json({ success: false, error: 'Landlord not found' });
      return;
    }

    if (!landlord.account_number) {
      res.status(400).json({ success: false, error: 'Bank details missing. Save bank details first.' });
      return;
    }

    const [withdrawal] = await db('withdrawals').insert({
      landlord_id: landlord.id,
      amount,
      bank_name: landlord.bank_name,
      account_number: landlord.account_number,
      status: 'PENDING'
    }).returning('*');

    logger.info({ withdrawalId: withdrawal.id, amount, landlordId: landlord.id }, 'Withdrawal initiated');
    res.status(201).json({
      success: true,
      amount,
      bankName: landlord.bank_name,
      bankLast4: landlord.account_number.slice(-4)
    });
  }),

  removeTenant: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const { tenantPhone } = z.object({ tenantPhone: phoneSchema }).parse(req.body);

    const landlord = await db('users').where({ phone, role: 'landlord' }).first();
    if (!landlord) {
      res.status(404).json({ success: false, error: 'Landlord not found' });
      return;
    }

    const tenantUser = await db('users').where({ phone: tenantPhone, role: 'tenant' }).first();
    if (!tenantUser) {
      res.status(404).json({ success: false, error: 'Tenant not found' });
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
      res.status(403).json({ success: false, error: 'Tenant not registered under your properties' });
      return;
    }

    await db('tenants').where({ id: tenantRecord.id }).update({ status: 'DISCONNECTED' });

    logger.info({ tenantId: tenantUser.id, landlordId: landlord.id }, 'Tenant removed');
    res.status(200).json({
      success: true,
      tenantName: tenantUser.name,
      propertyName: tenantRecord.propertyLabel
    });
  }),

  getSession: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    const data = await redis.get(`bot_session:${phone}`);
    res.status(200).json({ success: true, session: data ? JSON.parse(data) : null });
  }),

  updateSession: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
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
  }),

  clearSession: withBotHandler(async (req, res) => {
    const { phone } = z.object({ phone: phoneSchema }).parse(req.params);
    await redis.del(`bot_session:${phone}`);
    res.status(200).json({ success: true });
  }),

  createProperty: withBotHandler(async (req, res) => {
    const { phone, address, flatCount, label } = z.object({
      phone: phoneSchema,
      address: z.string().min(5).max(200),
      flatCount: z.number().int().positive(),
      label: z.string().min(2).max(100),
    }).parse(req.body);

    const landlord = await db('users').where({ phone, role: 'landlord' }).first();
    if (!landlord) {
      res.status(404).json({ success: false, error: 'Landlord not found' });
      return;
    }

    let isUnique = false;
    let code = '';
    let attempts = 0;
    while (!isUnique && attempts < 10) {
      code = `GRD-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const existing = await db('properties').where({ code }).first();
      if (!existing) isUnique = true;
      attempts++;
    }

    if (!isUnique) {
      res.status(500).json({ success: false, error: 'Failed to generate unique property code' });
      return;
    }

    const [property] = await db('properties').insert({
      landlord_id: landlord.id,
      code,
      label,
      address,
      flat_count: flatCount,
      status: 'ACTIVE'
    }).returning('*');

    logger.info({ propertyCode: code, landlordId: landlord.id }, 'Property created');
    res.status(201).json({
      success: true,
      code: property.code,
      label: property.label
    });
  }),
};
