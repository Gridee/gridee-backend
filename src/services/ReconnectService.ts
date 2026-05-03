import { logger } from '../lib/logger';
import {
  CannotReconnectZeroBalanceError,
  toGrd,
  type IHardwareLayer,
  type TenantId,
} from '../hal';
import type { Phone } from '../lib/phone';
import type { INotificationService } from '../notifications';

export interface ReconnectServiceOptions {
  hal: IHardwareLayer;
  notifications: INotificationService;
}

export interface PaymentConfirmedInput {
  tenantId: TenantId;
  tenantPhone: Phone;
  /** Amount paid in Naira — for the user-facing receipt. */
  amountNgn: number;
  /** GRD amount minted, in mGRD (integer). */
  mGrdMinted: number;
}

export interface PaymentConfirmedResult {
  /** mGRD added; balance after mint. */
  mGrdMinted: number;
  balanceAfterMGrd: number;
  /** Did we reconnect (because the tenant was previously CUTOFF)? */
  reconnected: boolean;
  /** Did the user get their purchase-confirmed notification? */
  purchaseNotified: boolean;
  /** Did the user get a "power restored" notification (only sent if reconnected)? */
  restoredNotified: boolean;
}

/**
 * Orchestrator for the payment-confirmed event.
 *
 * Called by the Flutterwave webhook handler AFTER:
 *   - Webhook signature is verified
 *   - Idempotency check passed
 *   - Payment row in DB transitioned to CONFIRMED
 *
 * This service handles the "what happens next" part:
 *   1. Mint GRD into the tenant's balance via HAL
 *   2. Send the purchase-confirmed notification
 *   3. If the tenant was previously CUTOFF (mint reports `wasDepleted`),
 *      reconnect the relay and send a "power restored" notification
 *
 * Like ConsumptionService, this never throws — failures are returned as
 * structured results so the webhook handler can log and ACK 200.
 */
export class ReconnectService {
  private readonly hal: IHardwareLayer;
  private readonly notifications: INotificationService;
  private readonly log: typeof logger;

  constructor(opts: ReconnectServiceOptions) {
    this.hal = opts.hal;
    this.notifications = opts.notifications;
    this.log = logger.child({ component: 'ReconnectService' });
  }

  async handlePaymentConfirmed(input: PaymentConfirmedInput): Promise<PaymentConfirmedResult> {
    const result: PaymentConfirmedResult = {
      mGrdMinted: 0,
      balanceAfterMGrd: 0,
      reconnected: false,
      purchaseNotified: false,
      restoredNotified: false,
    };

    // 1. Mint
    let mintRes: Awaited<ReturnType<IHardwareLayer['mint']>>;
    try {
      mintRes = await this.hal.mint(input.tenantId, input.mGrdMinted, { createIfMissing: true });
      result.mGrdMinted = mintRes.mGrdMinted;
      result.balanceAfterMGrd = mintRes.balanceAfterMGrd;
    } catch (err) {
      this.log.error(
        { tenantId: input.tenantId, err: (err as Error).message },
        'mint failed in handlePaymentConfirmed — payment was confirmed but balance not credited',
      );
      // Re-throw — this is a serious data integrity issue. The webhook handler
      // should NOT ack 200 on this; re-delivery via idempotency replay is the
      // right path, OR a manual reconciliation flow.
      throw err;
    }

    // 2. Always send purchase-confirmed receipt
    const grdAmount = toGrd(mintRes.mGrdMinted);
    const newBalanceGrd = toGrd(mintRes.balanceAfterMGrd);
    try {
      const notif = await this.notifications.sendPurchaseConfirmed(
        input.tenantPhone,
        grdAmount,
        newBalanceGrd,
      );
      result.purchaseNotified = notif.delivered;
    } catch (err) {
      // Notif service is non-throwing by contract, but defend against bugs.
      this.log.error(
        { tenantId: input.tenantId, err: (err as Error).message },
        'purchase notification threw',
      );
    }

    // 3. If wasDepleted, reconnect + restored notice
    if (mintRes.wasDepleted) {
      try {
        const cr = await this.hal.reconnect(input.tenantId);
        result.reconnected = cr.changed;
      } catch (err) {
        if (err instanceof CannotReconnectZeroBalanceError) {
          // Defensive: shouldn't happen if mint just succeeded with > 0
          this.log.error(
            { tenantId: input.tenantId },
            'Reconnect refused zero-balance after mint — programmer error?',
          );
        } else {
          this.log.error(
            { tenantId: input.tenantId, err: (err as Error).message },
            'reconnect failed after wasDepleted mint',
          );
        }
        return result;
      }

      try {
        const notif = await this.notifications.sendRestoredNotice(input.tenantPhone, newBalanceGrd);
        result.restoredNotified = notif.delivered;
      } catch (err) {
        this.log.error(
          { tenantId: input.tenantId, err: (err as Error).message },
          'restored notification threw',
        );
      }
    }

    return result;
  }
}
