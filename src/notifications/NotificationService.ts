import { logger } from '../lib/logger';
import type { Phone } from '../lib/phone';
import type { IMessageSender } from '../messaging';
import type { INotificationService, NotificationResult } from './INotificationService';
import type { ISmsProvider } from './ISmsProvider';

export interface NotificationServiceOptions {
  whatsapp: IMessageSender;
  /**
   * Optional SMS fallback. If omitted, the service is WhatsApp-only and
   * a WhatsApp failure leaves the user without any notification.
   */
  sms?: ISmsProvider;
}

/**
 * Default INotificationService implementation.
 *
 * Behavior:
 *   1. Compose user-facing copy here (will move to Mark's templates module
 *      when that lands; the interface stays the same).
 *   2. Try WhatsApp first.
 *   3. On WhatsApp failure, fall back to SMS if configured.
 *   4. Log every attempt with the channel and result.
 *   5. Never throw — return NotificationResult so callers can decide.
 *
 * Future enhancement: persist every attempt to a `notifications` table so
 * ops can see delivery rates and the user can replay receipts.
 */
export class NotificationService implements INotificationService {
  private readonly whatsapp: IMessageSender;
  private readonly sms: ISmsProvider | null;
  private readonly log: typeof logger;

  constructor(opts: NotificationServiceOptions) {
    this.whatsapp = opts.whatsapp;
    this.sms = opts.sms ?? null;
    this.log = logger.child({ component: 'NotificationService' });
  }

  // ─── Tenant alerts ────────────────────────────────────────────────────

  async sendLowBalanceAlert(phone: Phone, balanceGrd: number): Promise<NotificationResult> {
    const text =
      `⚠️ Your GRD balance is low: ${balanceGrd.toFixed(2)} GRD remaining. ` +
      `Top up to avoid disconnection.`;
    return this.dispatch(phone, text, 'ALERT_LOW_BALANCE');
  }

  async sendCutoffNotice(phone: Phone): Promise<NotificationResult> {
    const text =
      `Your power has been cut off due to a zero balance. ` +
      `Type BUY <amount> to top up.`;
    return this.dispatch(phone, text, 'ALERT_CUTOFF');
  }

  async sendRestoredNotice(phone: Phone, newBalanceGrd: number): Promise<NotificationResult> {
    const text =
      `✅ Your power has been restored. ` +
      `New balance: ${newBalanceGrd.toFixed(2)} GRD.`;
    return this.dispatch(phone, text, 'ALERT_RESTORED');
  }

  async sendPurchaseConfirmed(
    phone: Phone,
    grdAmount: number,
    newBalanceGrd: number,
  ): Promise<NotificationResult> {
    const text =
      `✅ Purchase confirmed: +${grdAmount.toFixed(2)} GRD. ` +
      `New balance: ${newBalanceGrd.toFixed(2)} GRD.`;
    return this.dispatch(phone, text, 'NOTIFY_PURCHASE_CONFIRMED');
  }

  async sendPaymentFailed(phone: Phone, reason: string): Promise<NotificationResult> {
    const text = `❌ Your payment could not be processed: ${reason}. Please try again.`;
    return this.dispatch(phone, text, 'PAYMENT_FAILED');
  }

  // ─── Landlord alerts ──────────────────────────────────────────────────

  async sendNewTenantAlert(
    landlordPhone: Phone,
    tenantName: string,
    propertyCode: string,
  ): Promise<NotificationResult> {
    const text =
      `🏠 New tenant: ${tenantName} just signed up at property ${propertyCode}. ` +
      `Type TENANTS ${propertyCode} to view.`;
    return this.dispatch(landlordPhone, text, 'NOTIFY_NEW_TENANT');
  }

  async sendWithdrawalInitiated(
    landlordPhone: Phone,
    amountNgn: number,
  ): Promise<NotificationResult> {
    const text =
      `💸 Withdrawal of ₦${amountNgn.toLocaleString('en-NG')} initiated. ` +
      `Funds will arrive in your bank account shortly.`;
    return this.dispatch(landlordPhone, text, 'WITHDRAWAL_INITIATED');
  }

  async sendWithdrawalConfirmed(
    landlordPhone: Phone,
    amountNgn: number,
  ): Promise<NotificationResult> {
    const text =
      `✅ Withdrawal confirmed: ₦${amountNgn.toLocaleString('en-NG')} ` +
      `has landed in your bank account.`;
    return this.dispatch(landlordPhone, text, 'NOTIFY_WITHDRAWAL_CONFIRMED');
  }

  // ─── Tenant removal — dual dispatch ───────────────────────────────────

  async sendTenantRemoved(args: {
    landlordPhone: Phone;
    tenantPhone: Phone;
    tenantName: string;
    propertyLabel: string;
  }): Promise<{ landlord: NotificationResult; tenant: NotificationResult }> {
    const landlordText =
      `Tenant ${args.tenantName} has been removed from ${args.propertyLabel}. ` +
      `Their unused balance has been refunded.`;
    const tenantText =
      `You have been removed from ${args.propertyLabel} by your landlord. ` +
      `Any unused GRD balance has been refunded.`;

    // Dispatch both in parallel — neither blocks the other
    const [landlord, tenant] = await Promise.all([
      this.dispatch(args.landlordPhone, landlordText, 'TENANT_REMOVED_LANDLORD'),
      this.dispatch(args.tenantPhone, tenantText, 'TENANT_REMOVED_EVICTED'),
    ]);

    return { landlord, tenant };
  }

  // ─── Internal: fallback chain ─────────────────────────────────────────

  private async dispatch(
    phone: Phone,
    text: string,
    screenId: string,
  ): Promise<NotificationResult> {
    // 1. Try WhatsApp
    try {
      await this.whatsapp.sendMessage({ to: phone, text, screenId });
      this.log.info({ screenId, channel: 'whatsapp' }, 'Notification sent');
      return { delivered: true, channelUsed: 'whatsapp' };
    } catch (err) {
      const whatsappErr = (err as Error).message;
      this.log.warn({ screenId, err: whatsappErr }, 'WhatsApp send failed');

      // 2. Fall back to SMS if available
      if (!this.sms) {
        return { delivered: false, channelUsed: null, error: `whatsapp: ${whatsappErr}` };
      }

      try {
        await this.sms.sendSms({ to: phone, text });
        this.log.info({ screenId, channel: 'sms', fallback: true }, 'Notification sent via SMS fallback');
        return { delivered: true, channelUsed: 'sms' };
      } catch (smsErr) {
        const smsErrMsg = (smsErr as Error).message;
        this.log.error(
          { screenId, whatsappErr, smsErr: smsErrMsg },
          'Both WhatsApp and SMS delivery failed',
        );
        return {
          delivered: false,
          channelUsed: null,
          error: `whatsapp: ${whatsappErr}; sms: ${smsErrMsg}`,
        };
      }
    }
  }
}
