import { logger } from '../lib/logger';
import type { INotificationService } from '../notifications';
import {
  PaymentNotFoundError,
  PaymentStateError,
  type IPaymentRepository,
  type PaymentRecord,
} from '../repositories';

export interface PaymentExpiryServiceOptions {
  paymentRepo: IPaymentRepository;
  notifications: INotificationService;
  /**
   * TTL after which a PENDING payment is expired. Default 15 minutes.
   * (15 min was decided in the planning session — long enough for slow
   *  bank transfers to land, short enough that a tenant retrying gets a
   *  fresh slot quickly.)
   */
  ttlMs?: number;
  /**
   * Max rows to expire per sweep. Default 1000.
   * Higher = fewer sweeps to drain a backlog; lower = gentler on infra.
   */
  batchLimit?: number;
  /**
   * If true (default), send a payment-failed notification to the tenant
   * when a payment expires. Set false in tests / dry-runs.
   */
  notifyOnExpiry?: boolean;
  /** Optional clock for deterministic tests. */
  clock?: () => number;
}

export interface ExpiryOutcome {
  paymentId: PaymentRecord['paymentId'];
  txRef: string;
  /** True if we successfully transitioned the row to EXPIRED. */
  expired: boolean;
  /** True if we tried to expire but the row had already moved to a terminal state (race with webhook). */
  alreadyResolved: boolean;
  notified: boolean;
  /** Error message if processing this row failed unexpectedly. */
  error?: string;
}

export interface ExpirySweepResult {
  candidates: number;
  expired: number;
  alreadyResolved: number;
  errored: number;
  notificationsSent: number;
  outcomes: ExpiryOutcome[];
  durationMs: number;
}

/**
 * Sweeps PENDING payments older than `ttlMs` and transitions them to EXPIRED.
 *
 * Race with webhook handler:
 *   It's possible a Flutterwave webhook arrives in the gap between
 *   `listStalePending()` and `transitionStatus()` for a given row. In that
 *   case `transitionStatus` throws PaymentStateError (row is no longer
 *   PENDING). We catch it and report `alreadyResolved: true` — that's not
 *   an error, it's the system working as designed.
 *
 * Per-row failure isolation:
 *   One row's unexpected failure (DB connection blip, etc.) is caught and
 *   the sweep continues with the rest. Failed rows are left PENDING for
 *   the next tick to pick up.
 */
export class PaymentExpiryService {
  private readonly paymentRepo: IPaymentRepository;
  private readonly notifications: INotificationService;
  private readonly ttlMs: number;
  private readonly batchLimit: number;
  private readonly notifyOnExpiry: boolean;
  private readonly clock: () => number;
  private readonly log: typeof logger;

  constructor(opts: PaymentExpiryServiceOptions) {
    this.paymentRepo = opts.paymentRepo;
    this.notifications = opts.notifications;
    this.ttlMs = opts.ttlMs ?? 15 * 60 * 1000;
    this.batchLimit = opts.batchLimit ?? 1000;
    this.notifyOnExpiry = opts.notifyOnExpiry ?? true;
    this.clock = opts.clock ?? Date.now;
    this.log = logger.child({ component: 'PaymentExpiryService' });
  }

  /**
   * Run one sweep across all stale PENDING payments.
   * Never throws — failures are captured into the result.
   */
  async sweep(): Promise<ExpirySweepResult> {
    const start = this.clock();
    const olderThan = start - this.ttlMs;

    let candidates: PaymentRecord[];
    try {
      candidates = await this.paymentRepo.listStalePending({
        olderThan,
        limit: this.batchLimit,
      });
    } catch (err) {
      this.log.error(
        { err: (err as Error).message },
        'listStalePending failed; skipping this sweep',
      );
      return {
        candidates: 0,
        expired: 0,
        alreadyResolved: 0,
        errored: 0,
        notificationsSent: 0,
        outcomes: [],
        durationMs: this.clock() - start,
      };
    }

    this.log.info(
      { candidateCount: candidates.length, ttlMs: this.ttlMs },
      'Expiry sweep started',
    );

    const outcomes: ExpiryOutcome[] = [];
    for (const row of candidates) {
      outcomes.push(await this.expireOne(row));
    }

    const result: ExpirySweepResult = {
      candidates: candidates.length,
      expired: outcomes.filter((o) => o.expired).length,
      alreadyResolved: outcomes.filter((o) => o.alreadyResolved).length,
      errored: outcomes.filter((o) => o.error !== undefined).length,
      notificationsSent: outcomes.filter((o) => o.notified).length,
      outcomes,
      durationMs: this.clock() - start,
    };

    this.log.info(
      {
        candidates: result.candidates,
        expired: result.expired,
        alreadyResolved: result.alreadyResolved,
        errored: result.errored,
        notificationsSent: result.notificationsSent,
        durationMs: result.durationMs,
      },
      'Expiry sweep complete',
    );

    return result;
  }

  /**
   * Expire one row. Public for testing. Never throws.
   */
  async expireOne(row: PaymentRecord): Promise<ExpiryOutcome> {
    const base: ExpiryOutcome = {
      paymentId: row.paymentId,
      txRef: row.txRef,
      expired: false,
      alreadyResolved: false,
      notified: false,
    };

    try {
      await this.paymentRepo.transitionStatus({
        paymentId: row.paymentId,
        nextStatus: 'EXPIRED',
      });
      base.expired = true;
    } catch (err) {
      if (err instanceof PaymentStateError) {
        // Race: webhook arrived first. The row is now CONFIRMED/FAILED/EXPIRED.
        // Don't notify; let the webhook's path handle communication.
        this.log.debug(
          { paymentId: row.paymentId, txRef: row.txRef },
          'Row no longer PENDING — webhook beat us to it',
        );
        return { ...base, alreadyResolved: true };
      }
      if (err instanceof PaymentNotFoundError) {
        // Row vanished between list and transition (deletion?). Should never
        // happen for payments, but defensive.
        return { ...base, error: 'payment_not_found' };
      }
      this.log.error(
        { paymentId: row.paymentId, err: (err as Error).message },
        'Expiry transition failed',
      );
      return { ...base, error: (err as Error).message };
    }

    if (this.notifyOnExpiry) {
      try {
        const notif = await this.notifications.sendPaymentFailed(
          row.tenantPhone,
          'Your payment timed out before we received confirmation. Please try again.',
        );
        base.notified = notif.delivered;
      } catch (err) {
        // Notification service is contractually non-throwing, but defend.
        this.log.error(
          { paymentId: row.paymentId, err: (err as Error).message },
          'Expiry notification threw',
        );
      }
    }

    return base;
  }
}
