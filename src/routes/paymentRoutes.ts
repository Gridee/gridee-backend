import { Router } from 'express';
import { db } from '../db';
import { mintTokens, distributeRevenue, getTokenBalance } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import crypto from 'crypto';
import { redis } from '../redis';

const router = Router();

router.post('/initiate', async (req, res) => {
  try {
    const { amountNGN, method, phone } = req.body;

    if (!amountNGN || !method || !phone) {
      res.status(400).json({ error: 'amountNGN, method, and phone are required' });
      return;
    }

    const user = await db('users').where({ phone }).first();
    if (!user || user.role !== 'tenant') {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    const grdPrice = parseFloat(process.env.GRD_PRICE_PER_NGN || '1');
    const grdAmount = amountNGN * grdPrice;

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

    if (method === 'bank_transfer') {
      res.status(200).json({
        paymentInstructionsMessage: `Transfer ₦${amountNGN.toLocaleString('en-NG')} to the account below. Use reference: ${reference}`,
        reference,
        accountNumber: '0123456789',
        bankName: 'Wema Bank',
        expiresAt: Date.now() + 15 * 60 * 1000,
        grdAmount,
      });
    } else if (method === 'mobile_money') {
      res.status(200).json({
        paymentInstructionsMessage: `Send ₦${amountNGN.toLocaleString('en-NG')} via mobile money. Reference: ${reference}`,
        reference,
        network: 'OPay',
        grdAmount,
      });
    } else {
      res.status(400).json({ error: 'Unsupported payment method' });
    }
  } catch (error) {
    console.error('[api/payments/initiate] error:', error);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const webhookHash = req.headers['verif-hash'] as string;
    const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;

    if (expectedHash && webhookHash !== expectedHash) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const { tx_ref, status, amount } = req.body;

    if (status !== 'successful') {
      res.status(200).json({ received: true });
      return;
    }

    const transaction = await db('transactions').where({ payment_ref: tx_ref }).first();
    if (!transaction) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }

    if (transaction.status === 'SUCCESSFUL') {
      res.status(200).json({ received: true });
      return;
    }

    const tenant = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where('tenants.id', transaction.tenant_id)
      .select(
        'users.wallet_address',
        'users.phone',
        'users.name',
        'users.id as user_id',
        'tenants.id as tenant_id',
        'tenants.property_id',
        'tenants.status as tenant_status'
      )
      .first();

    if (!tenant) {
      res.status(404).json({ error: 'Tenant not found' });
      return;
    }

    await mintTokens(tenant.wallet_address, transaction.grd_amount.toString());

    const property = await db('properties').where({ id: tenant.property_id }).first();
    const landlord = await db('users').where({ id: property?.landlord_id }).first();

    if (property && landlord?.wallet_address) {
      await distributeRevenue(property.code, landlord.wallet_address, transaction.grd_amount.toString());
    }

    if (tenant.tenant_status === 'DISCONNECTED') {
      await db('tenants').where({ id: tenant.tenant_id }).update({ status: 'CONNECTED' });
    }

    await db('transactions').where({ id: transaction.id }).update({ status: 'SUCCESSFUL' });

    const newBalance = await getTokenBalance(tenant.wallet_address);
 
    // Clear bot session so the user can use other commands immediately
    try {
      await redis.del(`gridee:session:${tenant.phone}`);
    } catch (redisErr) {
      console.error('[payment/webhook] failed to clear session:', redisErr);
    }

    // Notify user
    await notificationService.sendPurchaseConfirmed(
      { id: tenant.user_id, name: tenant.name, phone: tenant.phone },
      transaction.grd_amount,
      parseFloat(newBalance)
    );

    res.status(200).json({
      received: true,
      success: true,
      grdAmount: transaction.grd_amount,
      newBalance: parseFloat(newBalance),
    });
  } catch (error: any) {
    console.error('[api/payments/webhook] error:', error);
    if (error.shortMessage) {
      console.error('[api/payments/webhook] Blockchain Error:', error.shortMessage);
    }
    res.status(500).json({ error: 'Webhook processing failed', details: error.message });
  }
});

export default router;
