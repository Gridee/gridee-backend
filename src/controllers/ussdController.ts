import { Request, Response } from 'express';
import { db } from '../db';
import { getTokenBalance } from '../services/contractService';
import { ussdBalance, ussdHistory } from '../services/templateService';

export const ussdController = {
  async handleRequest(req: Request, res: Response): Promise<void> {
    const { phoneNumber, text } = req.body;

    // Split text by '*' to track depth in the USSD menu
    const parts = text.split('*');
    const lastInput = parts[parts.length - 1];

    // Basic Root Menu
    if (text === '') {
      res.send(`CON Welcome to Gridee ⚡\n1. Buy Tokens\n2. Check Balance\n3. History\n4. Help`);
      return;
    }

    // Route based on menu selection
    switch (parts[0]) {
      case '2': // Balance
        await ussdController.handleBalance(phoneNumber, res);
        break;
      case '3': // History
        await ussdController.handleHistory(phoneNumber, res);
        break;
      default:
        res.send(`END Invalid selection. Type the code again to restart.`);
    }
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
      const kwhEquivalent = parseFloat(balanceGrd); // GRD is 1:1 with kWh for display

      // Get last topup date
      const lastTx = await db('transactions')
        .where({ tenant_id: tenant.id, status: 'SUCCESSFUL' })
        .orderBy('created_at', 'desc')
        .first();

      const dateStr = lastTx 
        ? new Date(lastTx.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : 'Never';

      const responseText = ussdBalance(
        parseFloat(balanceGrd),
        kwhEquivalent,
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

      const txList = transactions.map(tx => ({
        date: new Date(tx.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }),
        amountNGN: Number(tx.amount_ngn),
        grdAmount: Number(tx.grd_amount)
      }));

      const responseText = ussdHistory(txList);
      res.send(`END ${responseText}`);
    } catch (error) {
      console.error('[ussd/history] error:', error);
      res.send(`END Failed to load history.`);
    }
  }
};
