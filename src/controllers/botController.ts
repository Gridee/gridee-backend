import { Request, Response } from 'express';
import { z } from 'zod';
import { redis } from '../redis';
import { db } from '../db';
import { contractService, getTokenBalance } from '../services/contractService';
import { PrivyWalletError, privyService } from '../services/privyService';
import { notificationService } from '../services/notificationService';
import { TRANSACTION_STATUS } from '../constants/transactionStatus';
import * as jwt from 'jsonwebtoken';

const LANDLORD_SHARE_BPS = parseInt(process.env.LANDLORD_SHARE_BPS || '8000', 10);
const PLATFORM_FEE_PERCENT = parseInt(process.env.PLATFORM_FEE_PERCENT || '10', 10);
const OPS_FEE_PERCENT = parseInt(process.env.OPS_FEE_PERCENT || '10', 10);

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
    let createdUserId: number | null = null;
    let createdTenantId: number | null = null;

    try {
      const { phone, name, propertyCode } = z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
        propertyCode: z.string().min(3),
      }).parse(req.body);

      const property = await db('properties')
        .where({ code: propertyCode.toUpperCase() })
        .first();

      if (!property) {
        res.status(404).json({
          success: false,
          error: "That Property Code wasn't found.",
        });
        return;
      }

      let user = await db('users').where({ phone }).first();

      if (user && user.role === 'tenant' && user.name !== 'New User') {
        res.status(200).json({ success: true, message: 'User already registered', user });
        return;
      }

      if (user) {
        const [updatedUser] = await db('users')
          .where({ id: user.id })
          .update({ name, role: 'tenant' })
          .returning('*');
        user = updatedUser;
      } else {
        const [newUser] = await db('users').insert({
          name,
          phone,
          role: 'tenant',
        }).returning('*');
        user = newUser;
        createdUserId = Number(newUser.id);
      }

      const [tenantRow] = await db('tenants').insert({
        user_id: user.id,
        property_id: property.id,
        status: 'CONNECTED',
      }).returning('id');
      createdTenantId = Number(tenantRow?.id);

      const { address: walletAddress, walletId } = await privyService.createEmbeddedWallet(user.id);
      
      // Update DB with wallet address and wallet ID
      await db('users').where({ id: user.id }).update({ 
        wallet_address: walletAddress,
        privy_user_id: walletId 
      });
      user.wallet_address = walletAddress;
      user.privy_user_id = walletId;

      // Register tenant on-chain in PropertyRegistry
      try {
        await contractService.registerTenant(propertyCode.toUpperCase(), walletAddress);
      } catch (onChainError) {
        console.error('[bot/tenants/register] on-chain registration failed:', onChainError);
      }

      // Notify landlord
      try {
        await notificationService.notifyLandlord(property.id, name);
      } catch (notifyError) {
        console.error('[bot/tenants/register] landlord notification failed:', notifyError);
      }

      const token = jwt.sign({ id: user.id, role: 'tenant' }, process.env.JWT_SECRET!, { expiresIn: '7d' });

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
      if (createdTenantId) {
        try {
          await db('tenants').where({ id: createdTenantId }).del();
        } catch (cleanupError) {
          console.error('[bot/tenants/register] tenant cleanup failed:', cleanupError);
        }
      }
      if (createdUserId) {
        try {
          await db('users').where({ id: createdUserId }).del();
        } catch (cleanupError) {
          console.error('[bot/tenants/register] user cleanup failed:', cleanupError);
        }
      }
      if (error instanceof PrivyWalletError) {
        console.error('[bot/tenants/register] privy error:', error.message);
        res.status(502).json({ success: false, error: 'Wallet provisioning failed. Please try again shortly.' });
        return;
      }
      res.status(500).json({ success: false, error: 'Registration failed' });
    }
  },

  async registerLandlord(req: Request, res: Response): Promise<void> {
    let createdUserId: number | null = null;

    try {
      const { phone, name } = z.object({
        phone: z.string().min(7),
        name: z.string().min(1),
      }).parse(req.body);

      const existingUser = await db('users').where({ phone }).first();
      if (existingUser && existingUser.name !== 'New User') {
        res.status(200).json({ success: true, message: 'User already registered', user: existingUser });
        return;
      }

      let newUser;
      if (existingUser) {
        [newUser] = await db('users')
          .where({ id: existingUser.id })
          .update({ name, role: 'landlord' })
          .returning('*');
      } else {
        [newUser] = await db('users').insert({
          name,
          phone,
          role: 'landlord'
        }).returning('*');
        createdUserId = Number(newUser.id);
      }

      const { address: walletAddress, walletId } = await privyService.createEmbeddedWallet(newUser.id);
      
      // Update DB with wallet address and wallet ID
      await db('users').where({ id: newUser.id }).update({ 
        wallet_address: walletAddress,
        privy_user_id: walletId
      });
      newUser.wallet_address = walletAddress;
      newUser.privy_user_id = walletId;

      const token = jwt.sign({ id: newUser.id, role: 'landlord' }, process.env.JWT_SECRET!, { expiresIn: '7d' });

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
      if (createdUserId) {
        try {
          await db('users').where({ id: createdUserId }).del();
        } catch (cleanupError) {
          console.error('[bot/landlords/register] user cleanup failed:', cleanupError);
        }
      }
      if (error instanceof PrivyWalletError) {
        console.error('[bot/landlords/register] privy error:', error.message);
        res.status(502).json({ success: false, error: 'Wallet provisioning failed. Please try again shortly.' });
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

      if (!user.wallet_address) {
        res.status(400).json({ error: 'Tenant wallet not provisioned. Please contact support.' });
        return;
      }

      const balanceGrd = await getTokenBalance(user.wallet_address);
      const lockedUsdc = await contractService.getTenantUsdcBalance(user.wallet_address);
      const currentUsdc = await contractService.getUsdcBalance(user.wallet_address);

      // Calculate hours remaining (MVP: use fixed rate from .env)
      const consumptionRate = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');
      const hoursLeft = Math.floor(parseFloat(balanceGrd) / consumptionRate);

      const lastTx = await db('transactions')
        .where({ tenant_id: tenant.id, status: TRANSACTION_STATUS.COMPLETED })
        .orderBy('created_at', 'desc')
        .first();

      const grdPrice = parseFloat(process.env.GRD_PRICE_PER_USDC || '1');
      const balanceUsdcEquivalent = parseFloat(balanceGrd) / grdPrice;
      const bps = parseFloat(process.env.LANDLORD_SHARE_BPS || '10000');

      res.status(200).json({
        balanceGrd: parseFloat(balanceGrd),
        balanceUSDC: Number(currentUsdc),
        lockedUsdc: Number(lockedUsdc),
        balanceUsdcEquivalent: Math.round(balanceUsdcEquivalent * 100) / 100,
        earningsGross: Math.round(balanceUsdcEquivalent * 100) / 100,
        earningsNet: Math.round((balanceUsdcEquivalent * (bps / 10000)) * 100) / 100,
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
        usdcAmount: Number(tx.usdc_amount),
        grdAmount: Number(tx.grd_amount),
        type: tx.type
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

  async fundWallet(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);

      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      res.status(200).json({ 
        success: true, 
        walletAddress: user.wallet_address,
        message: 'Step 1: Send USDC to your wallet.\nStep 2: Use the "Deposit" command to lock it into the platform for purchasing tokens.'
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, errors: error.issues });
        return;
      }
      console.error('[bot/fund] error:', error);
      res.status(500).json({ success: false, error: 'Failed to retrieve funding details' });
    }
  },

  async depositTokens(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { usdcAmount } = z.object({ usdcAmount: z.number().positive() }).parse(req.body);

      const user = await db('users').where({ phone, role: 'tenant' }).first();
      if (!user) {
        res.status(404).json({ success: false, error: 'Tenant not found' });
        return;
      }

      if (!user.privy_user_id) {
        res.status(400).json({ success: false, error: 'Wallet not fully provisioned. Please re-register.' });
        return;
      }

      const { txHash } = await contractService.depositUsdc(user.privy_user_id, usdcAmount.toString());

      res.status(200).json({ success: true, txHash, message: `Successfully deposited ${usdcAmount} USDC into the contract.` });
    } catch (error: any) {
      console.error('[bot/deposit] error:', error);
      res.status(500).json({ success: false, error: error.message || 'Failed to deposit USDC' });
    }
  },

  async buyTokens(req: Request, res: Response): Promise<void> {
    try {
      const { phone } = z.object({ phone: z.string().min(7) }).parse(req.params);
      const { usdcAmount } = z.object({ usdcAmount: z.number().positive() }).parse(req.body);

      const user = await db('users').where({ phone, role: 'tenant' }).first();
      if (!user) {
        res.status(404).json({ success: false, error: 'Tenant not found' });
        return;
      }

      const tenantRecord = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .join('users as landlords', 'properties.landlord_id', 'landlords.id')
        .where({ 'tenants.user_id': user.id })
        .select('tenants.id as tenant_id', 'properties.id as property_id', 'landlords.wallet_address as landlordWallet')
        .first();

      if (!tenantRecord) {
        res.status(404).json({ success: false, error: 'Tenant not linked to property' });
        return;
      }

      const lockedUsdc = await contractService.getTenantUsdcBalance(user.wallet_address);
      if (lockedUsdc < usdcAmount) {
        res.status(400).json({ 
          success: false, 
          error: `Insufficient locked USDC balance (${lockedUsdc}). Please DEPOSIT from your wallet to the platform first.` 
        });
        return;
      }

      if (!user.privy_user_id) {
        res.status(400).json({ success: false, error: 'Wallet not fully provisioned. Please re-register.' });
        return;
      }

      // Execute on-chain purchase via Privy
      const { txHash } = await contractService.purchaseTokens(
        user.privy_user_id,
        usdcAmount.toString(),
        tenantRecord.landlordWallet
      );

      // Record transaction
      await db('transactions').insert({
        tenant_id: tenantRecord.tenant_id,
        property_id: tenantRecord.property_id,
        grd_amount: usdcAmount, // assuming 1 USDC = 1 GRD for MVP
        usdc_amount: usdcAmount,
        tx_hash: txHash,
        type: 'buy',
        status: TRANSACTION_STATUS.COMPLETED
      });

      res.status(200).json({ success: true, txHash });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, errors: error.issues });
        return;
      }
      console.error('[bot/buy] error:', error);
      res.status(500).json({ success: false, error: 'Failed to purchase tokens' });
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
        .where({ 'transactions.status': TRANSACTION_STATUS.COMPLETED })
        .select('tenants.property_id')
        .sum('transactions.usdc_amount as total')
        .groupBy('tenants.property_id');

      const multiplier = LANDLORD_SHARE_BPS / 10000;

      const breakdown = properties.map(p => {
        const pEarnings = earnings.find(e => e.property_id === p.id);
        const gross = Number(pEarnings?.total || 0);
        return {
          code: p.code,
          label: p.label,
          grossEarnings: gross,
          netEarnings: Math.round(gross * multiplier * 100) / 100
        };
      });

      const totalGross = breakdown.reduce((sum, item) => sum + item.grossEarnings, 0);
      const totalNet = breakdown.reduce((sum, item) => sum + item.netEarnings, 0);

      res.status(200).json({ 
        totalGross, 
        totalNet, 
        platformFee: `${PLATFORM_FEE_PERCENT + OPS_FEE_PERCENT}%`,
        breakdown 
      });
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
        .where({ 'tenants.property_id': property.id, 'transactions.status': TRANSACTION_STATUS.COMPLETED })
        .sum('transactions.usdc_amount as total')
        .count('transactions.id as count')
        .first();

      const grossAmount = Number(earnings?.total || 0);
      const multiplier = LANDLORD_SHARE_BPS / 10000;
      const netAmount = Math.round(grossAmount * multiplier * 100) / 100;

      res.status(200).json({
        code,
        grossAmount,
        netAmount,
        platformFee: `${PLATFORM_FEE_PERCENT + OPS_FEE_PERCENT}%`,
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
      const { amount, destinationAddress } = z.object({ 
        amount: z.number().min(0),
        destinationAddress: z.string().startsWith('0x').length(42)
      }).parse(req.body);

      if (amount <= 0) {
        res.status(400).json({ error: 'Withdrawal amount must be greater than zero' });
        return;
      }

      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      if (!landlord.wallet_address || !landlord.privy_user_id) {
        res.status(400).json({ error: 'Landlord wallet not fully provisioned. Please re-register.' });
        return;
      }

      const usdcBalance = await contractService.getUsdcBalance(landlord.wallet_address);
      if (usdcBalance < amount) {
        res.status(400).json({ error: 'Insufficient USDC balance' });
        return;
      }

      const { txHash } = await contractService.transferUsdc(landlord.privy_user_id, destinationAddress, amount.toString());

      res.status(201).json({
        success: true,
        txHash
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid input', details: error.issues });
        return;
      }
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

  async getPlatformStats(req: Request, res: Response): Promise<void> {
    try {
      const stats = await contractService.getPlatformStats();
      res.status(200).json(stats);
    } catch (error: any) {
      console.error('[bot/platform/stats] error:', error);
      res.status(500).json({ error: 'Failed to fetch platform stats' });
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
      const { phone, address, flatCount, label, state } = z.object({
        phone: z.string().min(7),
        address: z.string().min(5),
        flatCount: z.number().int().positive(),
        label: z.string().min(2),
        state: z.string().min(2),
      }).parse(req.body);

      const landlord = await db('users').where({ phone, role: 'landlord' }).first();
      if (!landlord) {
        res.status(404).json({ error: 'Landlord not found' });
        return;
      }

      // Generate a unique Property Code
      let isUnique = false;
      let code = '';
      const stateAbbr = (state || 'LAG').substring(0, 3).toUpperCase();
      while (!isUnique) {
        const seq = String(Math.floor(Math.random() * 9000) + 1000);
        code = `GRD-${stateAbbr}-${seq}`;
        const existing = await db('properties').where({ code }).first();
        if (!existing) isUnique = true;
      }

      // 1. On-chain registration
      try {
        await contractService.registerProperty(code, landlord.wallet_address, flatCount, `${label}, ${state}`);
      } catch (onChainError) {
        console.error('[bot/properties/create] on-chain failed:', onChainError);
        // We continue to DB even if on-chain fails for now, or you might want to return 500
      }

      // 2. DB Insert
      const [property] = await db('properties').insert({
        landlord_id: landlord.id,
        code,
        label,
        address,
        state,
        flat_count: flatCount,
        status: 'ACTIVE'
      }).returning('*');

      res.status(201).json({
        success: true,
        code: property.code,
        label: property.label,
        state: property.state
      });
    } catch (error: any) {
      console.error('[bot/properties/create] error:', error);
      res.status(500).json({ error: 'Failed to create property' });
    }
  },
};
