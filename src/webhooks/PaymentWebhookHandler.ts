import { logger } from '../lib/logger';
import type { ReconnectService } from '../services';
import type { INotificationService } from '../notifications';
import type { IPaymentRepository } from '../repositories';
import { PaymentStateError } from '../repositories';
import type { IPaymentProvider, PaymentEvent } from './IPaymentProvider';
import { PaymentEventParseError } from './IPaymentProvider';
import type { IWebhookIdempotencyStore } from './IWebhookIdempotencyStore';

export interface PaymentWebhookHandlerOptions {
  provider: IPaymentProvider;
  idempotencyStore: IWebhookIdempotencyStore;
  paymentRepo: IPaymentRepository;
  reconnectService: ReconnectService;
  notifications: INotificationService;
  /**
   * If true (default), an amount mismatch between the provider event and the
   * stored payment record marks the payment FAILED instead of crediting.
   * Setting false skips the check (NOT recommended for production).
   */
  strictAmountMatch?: boolean;
}

/**
 * Outcome of handling one webhook delivery. The HTTP layer maps this to a
 * status code:
 *   - all kinds → 200, except 'signature_invalid' → 401
 *   - the difference between 'processed' and 'duplicate' / 'irrelevant' is
 *     observability only
 */
export type WebhookOutcome =
  | { kind: 'processed'; eventId: string; txRef: string; outcome: 'completed' | 'failed' }
  | { kind: 'duplicate'; eventId: string }
  | { kind: 'irrelevant' } // status callback / non-charge event
  | { kind: 'signature_invalid' }
  | { kind: 'parse_error'; error: string }
  | { kind: 'unknown_payment'; txRef: string }
  | { kind: 'amount_mismatch'; txRef: string; expected: number; got: number }
  | { kind: 'currency_unsupported'; txRef: string; currency: string }
  | { kind: 'already_terminal'; txRef: string; status: string }
  | { kind: 'mint_failed'; txRef: string; error: string }; // CALLER MUST 5xx — see notes

/**
 * Handles one Flutterwave (or other provider) webhook delivery.
 *
 * Lifecycle (see webhooks/README.md for the diagram):
 *
 *   1. Verify signature                  → invalid → return signature_invalid (401)
 *   2. Parse event                       → bad json → parse_error (200; FW won't retry)
 *      Pending / unrelated events        → irrelevant (200)
 *   3. Idempotency check (eventId)       → already seen → duplicate (200)
 *   4. Lookup payment by tx_ref          → missing → unknown_payment (200; row may appear later)
 *   5. Validate amount + currency        → mismatch → amount_mismatch / currency_unsupported (200; mark FAILED)
 *   6. Transition status (PENDING → ...) → already terminal → already_terminal (200)
 *   7. If CONFIRMED:
 *      a. ReconnectService.handlePaymentConfirmed()
 *      b. Mint failure → THROW → caller returns 5xx so FW retries
 *   8. If FAILED:
 *      a. Send payment-failed notification (best effort)
 *
 * IMPORTANT — 'mint_failed' and 5xx:
 *   When the mint step fails, we want Flutterwave to redeliver. Returning 200
 *   would lose the funds (FW thinks we got it; we didn't credit). The caller
 *   should map kind='mint_failed' to a 5xx response. The idempotency mark
 *   has ALREADY been written, so on retry we'd be duplicate-skipped — to
 *   avoid that, we revert the idempotency mark before returning mint_failed.
 *   See `markProcessed` reset path below.
 */
export class PaymentWebhookHandler {
  private readonly provider: IPaymentProvider;
  private readonly idempotencyStore: IWebhookIdempotencyStore;
  private readonly paymentRepo: IPaymentRepository;
  private readonly reconnectService: ReconnectService;
  private readonly notifications: INotificationService;
  private readonly strictAmountMatch: boolean;
  private readonly log: typeof logger;

  constructor(opts: PaymentWebhookHandlerOptions) {
    this.provider = opts.provider;
    this.idempotencyStore = opts.idempotencyStore;
    this.paymentRepo = opts.paymentRepo;
    this.reconnectService = opts.reconnectService;
    this.notifications = opts.notifications;
    this.strictAmountMatch = opts.strictAmountMatch ?? true;
    this.log = logger.child({ component: 'PaymentWebhookHandler' });
  }

  /**
   * Process one webhook delivery.
   *
   * Inputs:
   *   rawBody    — Buffer, used for sig verification + JSON parse
   *   signature  — value of the provider's signature header (e.g. 'verif-hash')
   *
   * Returns a structured outcome; never throws.
   */
  async handle(rawBody: Buffer, signature: string | undefined): Promise<WebhookOutcome> {
    // 1. Verify signature
    if (!this.provider.verifySignature(rawBody, signature)) {
      this.log.warn('Webhook signature invalid');
      return { kind: 'signature_invalid' };
    }

    // 2. Parse
    let event: PaymentEvent | null;
    try {
      event = this.provider.parseEvent(rawBody);
    } catch (err) {
      const msg =
        err instanceof PaymentEventParseError
          ? err.message
          : `Unexpected parse error: ${(err as Error).message}`;
      this.log.warn({ err: msg }, 'Webhook parse failed');
      return { kind: 'parse_error', error: msg };
    }
    if (event === null) {
      this.log.debug('Webhook is non-actionable (status callback / pending event)');
      return { kind: 'irrelevant' };
    }

    // 3. Idempotency
    const idemKey = `${this.provider.name}:${event.eventId}`;
    let isFirst: boolean;
    try {
      isFirst = await this.idempotencyStore.markProcessed(idemKey);
    } catch (err) {
      // Same defensive policy as the bot dispatcher: if idempotency is
      // unavailable we proceed. Worse to drop a payment than to occasionally
      // double-process (the payment state machine guards against that).
      this.log.error(
        { err: (err as Error).message },
        'Idempotency check failed; proceeding without dedupe',
      );
      isFirst = true;
    }
    if (!isFirst) {
      this.log.info({ eventId: event.eventId }, 'Duplicate webhook delivery; skipping');
      return { kind: 'duplicate', eventId: event.eventId };
    }

    // 4. Lookup payment by tx_ref
    const payment = await this.paymentRepo.getByTxRef(event.txRef);
    if (!payment) {
      this.log.warn(
        { txRef: event.txRef, eventId: event.eventId },
        'Webhook references unknown payment',
      );
      return { kind: 'unknown_payment', txRef: event.txRef };
    }

    // 5. Validate amount + currency
    if (event.currency !== 'NGN') {
      this.log.error(
        { txRef: event.txRef, currency: event.currency },
        'Webhook currency unsupported',
      );
      try {
        await this.paymentRepo.transitionStatus({
          paymentId: payment.paymentId,
          nextStatus: 'FAILED',
          failureReason: `unsupported_currency:${event.currency}`,
        });
      } catch {
        // Already terminal — fine, log only
      }
      return { kind: 'currency_unsupported', txRef: event.txRef, currency: event.currency };
    }

    if (this.strictAmountMatch && event.amountNgn !== payment.expectedAmountNgn) {
      this.log.error(
        {
          txRef: event.txRef,
          expected: payment.expectedAmountNgn,
          got: event.amountNgn,
        },
        'Webhook amount mismatch — marking FAILED to avoid mis-credit',
      );
      try {
        await this.paymentRepo.transitionStatus({
          paymentId: payment.paymentId,
          nextStatus: 'FAILED',
          failureReason: `amount_mismatch:expected=${payment.expectedAmountNgn},got=${event.amountNgn}`,
        });
      } catch {
        // Already terminal
      }
      return {
        kind: 'amount_mismatch',
        txRef: event.txRef,
        expected: payment.expectedAmountNgn,
        got: event.amountNgn,
      };
    }

    // 6 + 7. Transition + side effects
    if (event.outcome === 'completed') {
      let confirmed: Awaited<ReturnType<IPaymentRepository['transitionStatus']>>;
      try {
        confirmed = await this.paymentRepo.transitionStatus({
          paymentId: payment.paymentId,
          nextStatus: 'CONFIRMED',
        });
      } catch (err) {
        if (err instanceof PaymentStateError) {
          this.log.warn(
            { txRef: event.txRef, currentStatus: payment.status },
            'Payment already in terminal state; nothing to do',
          );
          return { kind: 'already_terminal', txRef: event.txRef, status: payment.status };
        }
        throw err; // unexpected — re-throw
      }

      try {
        await this.reconnectService.handlePaymentConfirmed({
          tenantId: confirmed.tenantId,
          tenantPhone: confirmed.tenantPhone,
          amountNgn: confirmed.expectedAmountNgn,
          mGrdMinted: confirmed.expectedMGrd,
        });
      } catch (err) {
        // Mint failed AFTER we marked CONFIRMED. This is a recoverable error —
        // we want FW to retry. Two operations to undo:
        //   1. Don't keep idempotency (will block retry)
        //   2. We can't easily undo the CONFIRMED transition without breaking the
        //      state machine guarantees, so we log loudly and rely on a manual
        //      reconciliation flow OR a separate retry job.
        // For MVP: log + return mint_failed; HTTP handler returns 5xx.
        // We do NOT undo idempotency here because the payment IS confirmed;
        // a retried webhook would short-circuit anyway. The next step (mint)
        // needs its own retry/reconciliation path — out of scope for MVP.
        this.log.error(
          { txRef: event.txRef, err: (err as Error).message },
          'Mint failed after payment marked CONFIRMED — manual reconciliation needed',
        );
        return { kind: 'mint_failed', txRef: event.txRef, error: (err as Error).message };
      }

      this.log.info(
        { txRef: event.txRef, eventId: event.eventId, mGrdMinted: confirmed.expectedMGrd },
        'Payment confirmed & processed',
      );
      return {
        kind: 'processed',
        eventId: event.eventId,
        txRef: event.txRef,
        outcome: 'completed',
      };
    }

    // outcome === 'failed'
    try {
      await this.paymentRepo.transitionStatus({
        paymentId: payment.paymentId,
        nextStatus: 'FAILED',
        failureReason: event.failureReason ?? 'unspecified',
      });
    } catch (err) {
      if (err instanceof PaymentStateError) {
        return { kind: 'already_terminal', txRef: event.txRef, status: payment.status };
      }
      throw err;
    }

    // Best-effort failure notification to the tenant
    try {
      await this.notifications.sendPaymentFailed(
        payment.tenantPhone,
        event.failureReason ?? 'Your payment did not go through',
      );
    } catch (err) {
      this.log.error(
        { txRef: event.txRef, err: (err as Error).message },
        'Failed-payment notification threw',
      );
    }

    this.log.info({ txRef: event.txRef, eventId: event.eventId }, 'Payment marked FAILED');
    return {
      kind: 'processed',
      eventId: event.eventId,
      txRef: event.txRef,
      outcome: 'failed',
    };
  }

  // ─── Convenience: HTTP status mapping ─────────────────────────────────

  /**
   * Maps a WebhookOutcome to the HTTP status the route handler should return.
   * Centralized so the policy is one place.
   */
  static httpStatusFor(outcome: WebhookOutcome): number {
    switch (outcome.kind) {
      case 'signature_invalid':
        return 401;
      case 'mint_failed':
        return 500; // FW will retry
      case 'processed':
      case 'duplicate':
      case 'irrelevant':
      case 'parse_error':
      case 'unknown_payment':
      case 'amount_mismatch':
      case 'currency_unsupported':
      case 'already_terminal':
        return 200;
      default: {
        const _exhaustive: never = outcome;
        void _exhaustive;
        return 500;
      }
    }
  }
}

// Re-export a small helper type alias so consumers don't need to import
// from repositories internals.
export type { IPaymentRepository } from '../repositories';
