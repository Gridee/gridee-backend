import type { Phone } from '../lib/phone';

/**
 * Outbound SMS interface.
 *
 * Distinct from IMessageSender (which is WhatsApp/messaging). SMS in Nigeria
 * is the universal fallback when WhatsApp delivery fails — feature phones,
 * blocked numbers, account suspensions.
 *
 * Production candidates:
 *   - Africa's Talking SMS API (cheapest in Nigeria; same provider AT
 *     uses for WhatsApp, so single bill if both used)
 *   - Termii (Nigeria-specific, good deliverability for OTPs)
 *   - Twilio SMS (most expensive, best for international)
 */
export interface ISmsProvider {
  readonly name: string;
  /**
   * Send an SMS. Throws on transport / 5xx errors; returns a receipt on
   * success. 4xx errors (bad number, suspended account) should throw too —
   * the NotificationService treats both as "delivery failed" without retry.
   */
  sendSms(input: { to: Phone; text: string }): Promise<SmsReceipt>;
}

export interface SmsReceipt {
  to: Phone;
  providerMessageId: string;
  provider: string;
  sentAt: number;
}
