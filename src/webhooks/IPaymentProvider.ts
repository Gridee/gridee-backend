import { GrideeError } from '../lib/errors';

/**
 * Payment provider abstraction.
 *
 * OWNERSHIP: Mark David owns the full IPaymentProvider — payment initiation,
 * payout, KYC, etc. This file defines the SUBSET that the webhook handler
 * needs: signature verification + event parsing. Once Mark's full module
 * lands, this file should re-export from his package; the interface
 * contract here is the agreement.
 *
 * For MVP, only Flutterwave is implemented. Adding Paystack later means
 * implementing this interface with a different signature scheme + event shape.
 */
export interface IPaymentProvider {
  /** Provider name — 'flutterwave', 'paystack', etc. Used as namespace key. */
  readonly name: string;

  /**
   * Verify the webhook signature using the raw body bytes and the signature
   * header value. Implementations MUST use timing-safe comparison.
   *
   * Returns true if signature is valid, false otherwise. Never throws.
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;

  /**
   * Parse a verified webhook payload into a normalized PaymentEvent.
   * Throws PaymentEventParseError if the payload doesn't conform to the
   * provider's expected shape.
   *
   * Status-callback / non-payment events return null (caller acks 200 + skips).
   */
  parseEvent(rawBody: Buffer): PaymentEvent | null;
}

/**
 * Normalized payment event — provider-agnostic. The webhook handler operates
 * on this shape, so adding a new provider = a new IPaymentProvider impl,
 * zero handler changes.
 */
export interface PaymentEvent {
  /** Provider's globally-unique event ID. Used for idempotency. */
  eventId: string;
  /** The reference WE sent on /payments/initiate. */
  txRef: string;
  /**
   * What happened. 'completed' = funds received; 'failed' = explicit failure.
   * Pending / status-only callbacks should be filtered by parseEvent → null.
   */
  outcome: 'completed' | 'failed';
  /** Amount the user actually paid, in Naira. Verified against our expectedAmountNgn. */
  amountNgn: number;
  /** ISO 4217 currency code. We only accept 'NGN' for MVP. */
  currency: string;
  /** Provider-side failure reason, if outcome === 'failed'. */
  failureReason?: string;
  /** Original raw event for audit log. */
  rawPayload: unknown;
}

export class PaymentEventParseError extends GrideeError {}
