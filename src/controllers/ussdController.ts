import { Request, Response } from 'express';
import { db } from '../db';
import { getTokenBalance } from '../services/contractService';
import { ussdBalance, ussdHistory } from '../services/templateService';

export const ussdController = {
  async handleRequest(req: Request, res: Response): Promise<void> {
    const { phoneNumber, text } = req.body;

    const parts = text.split('*');

    if (text === '') {
      res.send(`CON Welcome to Gridee\n1. Buy Tokens\n2. Check Balance\n3. History\n4. Help`);
      return;
    }

    switch (parts[0]) {
      case '1':
        await ussdController.handleBuy(phoneNumber, parts.slice(1).join('*'), res);
        break;
      case '2':
        await ussdController.handleBalance(phoneNumber, res);
        break;
      case '3':
        await ussdController.handleHistory(phoneNumber, res);
        break;
      case '4':
        await ussdController.handleHelp(res);
        break;
      default:
        res.send(`END Invalid selection. Type the code again to restart.`);
    }
  },

  async handleBuy(phone: string, input: string, res: Response): Promise<void> {
    if (!input) {
      res.send(`CON Enter amount in Naira (e.g. 2000):`);
      return;
    }

    const amount = parseInt(input, 10);
    if (isNaN(amount) || amount <= 0) {
      res.send(`CON Invalid amount. Enter a number (e.g. 2000):`);
      return;
    }

    const grdPrice = parseFloat(process.env.GRD_PRICE_PER_NGN || '1');
    const grdAmount = amount * grdPrice;
    const kwh = grdAmount;

    const user = await db('users').where({ phone }).first();
    if (user && user.role === 'tenant') {
      const tenant = await db('tenants').where({ user_id: user.id }).first();
      const reference = `GRD-USSD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      if (tenant) {
        await db('transactions').insert({
          tenant_id: tenant.id,
          amount_ngn: amount,
          grd_amount: grdAmount,
          payment_method: 'bank_transfer',
          payment_ref: reference,
          status: 'PENDING'
        });
      }
    }

    res.send(`END You're buying ${kwh} kWh for NGN ${amount.toLocaleString()}. Payment instructions will be sent to your phone via SMS.`);
  },

  async handleBalance(phone: string, res: Response): Promise<void> {
    try {
      const user = await db('users').where({ phone }).first();
      if (!user || user.role !== 'tenant') {
        res.send(`END You aren't registered as a tenant. Join via WhatsApp first!`);
        return;
      }

      const tenant = await db('tenants')
        .join('properties', 'tenants.property_id', 'properties.id')
        .where({ 'tenants.user_id': user.id })
        .select('tenants.*', 'properties.label as propertyLabel')
        .first();

      if (!tenant) {
        res.send(`END No property linked to your account.`);
        return;
      }

      const balanceGrd = await getTokenBalance(user.wallet_address || '');
      const consumptionRate = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');
      const hoursLeft = Math.floor(parseFloat(balanceGrd) / consumptionRate);

      const lastTx = await db('transactions')
        .where({ tenant_id: tenant.id, status: 'SUCCESSFUL' })
        .orderBy('created_at', 'desc')
        .first();

      const dateStr = lastTx
        ? new Date(lastTx.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : 'Never';

      const responseText = ussdBalance(
        parseFloat(balanceGrd),
        hoursLeft,
        dateStr,
        tenant.status === 'CONNECTED' ? 'Connected' : 'Disconnected'
      );

      res.send(`END ${responseText}`);
    } catch (error) {
      console.error('[ussd/balance] error:', error);
      res.send(`END Sorry, we couldn't fetch your balance. Try again later.`);
    }
  },

  async handleHistory(phone: string, res: Response): Promise<void> {
    try {
      const user = await db('users').where({ phone }).first();
      if (!user) {
        res.send(`END User not found.`);
        return;
      }

      const tenant = await db('tenants').where({ user_id: user.id }).first();
      if (!tenant) {
        res.send(`END Tenant record not found.`);
        return;
      }

      const transactions = await db('transactions')
        .where({ tenant_id: tenant.id })
        .orderBy('created_at', 'desc')
        .limit(5);

      const txList = transactions.map((tx: any) => ({
        date: new Date(tx.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
        amountNaira: Number(tx.amount_ngn),
        grdAmount: Number(tx.grd_amount)
      }));

      const responseText = ussdHistory(txList);
      res.send(`END ${responseText}`);
    } catch (error) {
      console.error('[ussd/history] error:', error);
      res.send(`END Failed to load history.`);
    }
  },

  async handleHelp(res: Response): Promise<void> {
    res.send(`END Gridee Commands:\n1. Buy Tokens\n2. Check Balance\n3. History\n4. Help\n5. My Property (tenants)\nDial again for landlord menu.`);
  }
};
