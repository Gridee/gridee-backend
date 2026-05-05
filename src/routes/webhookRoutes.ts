import { Router } from 'express';
import { db } from '../db';
import { mintTokens, distributeRevenue, getTokenBalance } from '../services/contractService';
import { notificationService } from '../services/notificationService';
import { redis } from '../redis';
import { logger } from '../lib/logger';

const router = Router();

router.post('/flutterwave', async (req, res) => {
  try {
    const webhookHash = req.headers['verif-hash'] as string;
    const expectedHash = process.env.FLUTTERWAVE_WEBHOOK_HASH;

    if (expectedHash && webhookHash !== expectedHash) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const { tx_ref, status } = req.body;

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
      logger.error({ err: redisErr }, 'Failed to clear session after webhook');
    }

    // Notify user
    await notificationService.sendPurchaseConfirmed(
      { id: tenant.user_id, name: tenant.name, phone: tenant.phone },
      transaction.grd_amount,
      parseFloat(newBalance)
    );

    logger.info({ transactionId: transaction.id, newBalance }, 'Payment webhook processed');
    res.status(200).json({
      received: true,
      success: true,
      grdAmount: transaction.grd_amount,
      newBalance: parseFloat(newBalance),
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'Webhook processing failed');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
