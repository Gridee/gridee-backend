import cron from 'node-cron';
import { db } from '../db';
import { HAL } from '../hal';
import { lowBalanceAlert, cutoffNotice, restoredNotice } from '../services/templateService';
import { sendSMS } from '../services/smsService';

const CONSUMPTION_KWH_PER_HOUR = parseFloat(process.env.CONSUMPTION_KWH_PER_HOUR || '0.5');
const LOW_BALANCE_THRESHOLD = 1;

async function notifyTenant(phone: string, message: string): Promise<void> {
  try {
    await sendSMS(phone, message);
  } catch {
    console.error(`[consumption] Failed to notify tenant ${phone}`);
  }
}

async function runConsumptionCycle(): Promise<void> {
  try {
    const activeTenants = await db('tenants')
      .join('users', 'tenants.user_id', 'users.id')
      .where({ 'tenants.status': 'CONNECTED' })
      .select('tenants.id', 'users.phone', 'users.wallet_address');

    let processed = 0;
    let alertsSent = 0;
    let cutOffs = 0;

    for (const tenant of activeTenants) {
      processed++;

      try {
        const balanceBefore = await HAL.getMeterBalance(tenant.id);

        await HAL.deductConsumption(tenant.id, CONSUMPTION_KWH_PER_HOUR);

        const balanceAfter = await HAL.getMeterBalance(tenant.id);

        if (balanceAfter <= 0 && balanceBefore > 0) {
          await HAL.cutOff(tenant.id);
          cutOffs++;
          if (tenant.phone) {
            await notifyTenant(tenant.phone, cutoffNotice());
          }
          console.log(`[consumption] Tenant ${tenant.id} cut off (balance: ${balanceAfter})`);
        } else if (balanceAfter < LOW_BALANCE_THRESHOLD && balanceBefore >= LOW_BALANCE_THRESHOLD) {
          alertsSent++;
          if (tenant.phone) {
            await notifyTenant(tenant.phone, lowBalanceAlert(balanceAfter, balanceAfter));
          }
          console.log(`[consumption] Tenant ${tenant.id} low balance alert (balance: ${balanceAfter})`);
        } else if (balanceAfter > 0 && balanceBefore <= 0) {
          await HAL.reconnect(tenant.id);
          if (tenant.phone) {
            await notifyTenant(tenant.phone, restoredNotice(balanceAfter));
          }
          console.log(`[consumption] Tenant ${tenant.id} reconnected (balance: ${balanceAfter})`);
        }
      } catch (error) {
        console.error(`[consumption] Error processing tenant ${tenant.id}:`, error);
      }
    }

    console.log(`[consumption] Cycle complete: ${processed} processed, ${alertsSent} alerts, ${cutOffs} cut-offs`);
  } catch (error) {
    console.error('[consumption] Cycle failed:', error);
  }
}

let scheduledTask: cron.ScheduledTask | null = null;

export function startConsumptionEngine(): void {
  scheduledTask = cron.schedule('0 * * * *', runConsumptionCycle);
  console.log('[consumption] Engine started — runs every hour');
}

export function stopConsumptionEngine(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[consumption] Engine stopped');
  }
}
