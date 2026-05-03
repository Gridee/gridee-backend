import type { Phone } from '../lib/phone';

/**
 * Outcome of a notification attempt.
 * The orchestrator (ConsumptionService, payment webhook) does not block on
 * failures — relay flips and balance updates take precedence over a notif.
 */
export interface NotificationResult {
  /** Was the message delivered to at least one channel? */
  delivered: boolean;
  /** Which channel ultimately delivered (or null if all failed). */
  channelUsed: 'whatsapp' | 'sms' | null;
  /** Error message if delivery failed entirely. */
  error?: string;
}

/**
 * Interface for sending all system-initiated notifications.
 *
 * Every event in SCREENS.md that the backend originates flows through here:
 *   - Tenant alerts: low balance, cutoff, restored, purchase confirmed, payment failed
 *   - Landlord alerts: new tenant, withdrawal events
 *
 * Implementations (now): WhatsApp first, fall back to SMS, log every attempt.
 * Implementations (future): also persist to a `notifications` audit table.
 *
 * IMPORTANT: methods are non-throwing. They return a NotificationResult so
 * orchestrators can act on success/failure without try/catch noise.
 */
export interface INotificationService {
  // ── Tenant ────────────────────────────────────────────────────────────
  sendLowBalanceAlert(phone: Phone, balanceGrd: number): Promise<NotificationResult>;
  sendCutoffNotice(phone: Phone): Promise<NotificationResult>;
  sendRestoredNotice(phone: Phone, newBalanceGrd: number): Promise<NotificationResult>;
  sendPurchaseConfirmed(
    phone: Phone,
    grdAmount: number,
    newBalanceGrd: number,
  ): Promise<NotificationResult>;
  sendPaymentFailed(phone: Phone, reason: string): Promise<NotificationResult>;

  // ── Landlord ──────────────────────────────────────────────────────────
  sendNewTenantAlert(
    landlordPhone: Phone,
    tenantName: string,
    propertyCode: string,
  ): Promise<NotificationResult>;
  sendWithdrawalInitiated(
    landlordPhone: Phone,
    amountNgn: number,
  ): Promise<NotificationResult>;
  sendWithdrawalConfirmed(
    landlordPhone: Phone,
    amountNgn: number,
  ): Promise<NotificationResult>;

  // ── Tenant removal — dual-dispatch event ─────────────────────────────
  /**
   * Per SCREENS.md, when a landlord removes a tenant, BOTH parties are
   * notified with different messages. Returns one result per recipient.
   */
  sendTenantRemoved(args: {
    landlordPhone: Phone;
    tenantPhone: Phone;
    tenantName: string;
    propertyLabel: string;
  }): Promise<{
    landlord: NotificationResult;
    tenant: NotificationResult;
  }>;
}
