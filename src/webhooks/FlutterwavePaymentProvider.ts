import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { ConfigError } from '../lib/errors';
import {
  type IPaymentProvider,
  type PaymentEvent,
  PaymentEventParseError,
} from './IPaymentProvider';

export interface FlutterwavePaymentProviderOptions {
  /**
   * Webhook secret hash configured in the Flutterwave dashboard.
   * Sent back on every webhook in the `verif-hash` header.
   */
  secretHash: string;
}

/**
 * Flutterwave webhook event payload schema.
 *
 * Reference shape (post-2023 v3):
 * {
 *   "event": "charge.completed",
 *   "data": {
 *     "id": 123456,                  // Flutterwave's internal numeric id
 *     "tx_ref": "TX_abc",            // OUR reference, sent at /initiate
 *     "amount": 5000,
 *     "currency": "NGN",
 *     "status": "successful",        // "successful" | "failed" | "pending"
 *     ...
 *   }
 * }
 *
 * Source: https://developer.flutterwave.com/docs/integration-guides/webhooks
 */
const FlutterwaveEventSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.union([z.number(), z.string()]),
    tx_ref: z.string().min(1),
    amount: z.number().positive(),
    currency: z.string().min(1),
    status: z.string().min(1),
    /** Optional fields we don't act on but parse for the audit trail. */
    processor_response: z.string().optional(),
    failure_reason: z.string().optional(),
  }),
});

export class FlutterwavePaymentProvider implements IPaymentProvider {
  readonly name = 'flutterwave';
  private readonly secretHash: string;

  constructor(opts: FlutterwavePaymentProviderOptions) {
    if (!opts.secretHash) {
      throw new ConfigError('FlutterwavePaymentProvider: secretHash is required');
    }
    this.secretHash = opts.secretHash;
  }

  /**
   * Flutterwave signs by sending the raw `secretHash` value back in the
   * `verif-hash` header. We compare with timing-safe equality.
   *
   * (Yes, FW's webhook auth really is "send a shared secret in a header" —
   * not HMAC. The secret is rotatable per-environment in their dashboard.)
   */
  verifySignature(_rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (typeof signatureHeader !== 'string' || signatureHeader.length === 0) return false;
    const provided = Buffer.from(signatureHeader, 'utf8');
    const expected = Buffer.from(this.secretHash, 'utf8');
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  }

  parseEvent(rawBody: Buffer): PaymentEvent | null {
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      throw new PaymentEventParseError(
        `Webhook body is not valid JSON: ${(err as Error).message}`,
      );
    }

    const parsed = FlutterwaveEventSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new PaymentEventParseError(`Webhook body did not match Flutterwave schema: ${issues}`);
    }

    const { event, data } = parsed.data;

    // We only act on charge.completed (whether successful or failed).
    // Pending / refund / other events get acked but skipped.
    if (event !== 'charge.completed') return null;

    const status = data.status.toLowerCase();
    let outcome: 'completed' | 'failed';
    if (status === 'successful') outcome = 'completed';
    else if (status === 'failed') outcome = 'failed';
    else return null; // pending / unknown — skip

    const result: PaymentEvent = {
      eventId: String(data.id),
      txRef: data.tx_ref,
      outcome,
      amountNgn: data.amount,
      currency: data.currency.toUpperCase(),
      rawPayload: json,
    };
    if (outcome === 'failed') {
      result.failureReason = data.failure_reason ?? data.processor_response ?? 'unspecified';
    }
    return result;
  }
}
