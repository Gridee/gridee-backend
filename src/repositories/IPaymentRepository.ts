import { GrideeError } from '../lib/errors';
import type {
  PaymentId,
  PaymentMethod,
  PaymentRecord,
  PaymentStatus,
} from './PaymentTypes';
import type { Phone } from '../lib/phone';
import type { TenantId } from '../hal';

export class PaymentRepoError extends GrideeError {}
export class PaymentNotFoundError extends PaymentRepoError {
  constructor(public readonly key: string) {
    super(`Payment not found: ${key}`);
  }
}
export class PaymentStateError extends PaymentRepoError {}

/**
 * Storage interface for payment records.
 *
 * Production impl will be PostgreSQL-backed by the `payments` table; this
 * interface lets us unit-test webhook + ReconnectService wiring without DB.
 *
 * IMPORTANT: `transitionStatus` MUST be atomic — read-check-write in one
 * statement. Postgres impl uses `UPDATE ... WHERE id = $1 AND status = $2
 * RETURNING *` so a stale read can't smuggle a CONFIRMED → CONFIRMED
 * transition through.
 */
export interface IPaymentRepository {
  /** Returns null if no record. */
  getById(paymentId: PaymentId): Promise<PaymentRecord | null>;

  /** Returns null if no record. Used by the webhook handler to look up by `tx_ref`. */
  getByTxRef(txRef: string): Promise<PaymentRecord | null>;

  /**
   * Insert a new PENDING payment row. Used when the bot calls
   * /api/payments/initiate.
   *
   * Rejects if a row with the same paymentId or txRef already exists
   * (collision = bug, not a recoverable state).
   */
  create(input: CreatePaymentInput): Promise<PaymentRecord>;

  /**
   * Atomic state transition. Only PENDING records can transition.
   *
   * Returns the updated row on success, or throws PaymentStateError if:
   *   - Record is not in PENDING state
   *   - Record doesn't exist
   *
   * `failureReason` is required when transitioning to FAILED.
   */
  transitionStatus(input: TransitionInput): Promise<PaymentRecord>;

  /**
   * Returns PENDING rows whose `createdAt` is older than the given epoch-ms
   * threshold. Used by the expiry sweeper.
   *
   * The Postgres impl will be:
   *   SELECT * FROM payments
   *    WHERE status = 'PENDING' AND created_at < $1
   *    ORDER BY created_at ASC
   *    LIMIT $2
   *
   * `limit` caps the batch size so the sweeper can't take all night on a
   * backlog. The cron retries on the next tick, draining the queue gradually.
   */
  listStalePending(input: ListStalePendingInput): Promise<PaymentRecord[]>;
}

export interface ListStalePendingInput {
  /** Epoch ms; rows with createdAt strictly less than this are returned. */
  olderThan: number;
  /** Max rows. Default 1000. */
  limit?: number;
}

export interface CreatePaymentInput {
  paymentId: PaymentId;
  tenantId: TenantId;
  tenantPhone: Phone;
  txRef: string;
  expectedAmountNgn: number;
  expectedMGrd: number;
  method: PaymentMethod;
  provider: string;
}

export type TransitionInput =
  | { paymentId: PaymentId; nextStatus: 'CONFIRMED' }
  | { paymentId: PaymentId; nextStatus: 'FAILED'; failureReason: string }
  | { paymentId: PaymentId; nextStatus: 'EXPIRED' };

// ─────────────────────────────────────────────────────────────────────────────
// In-memory impl
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryPaymentRepository implements IPaymentRepository {
  private readonly byId = new Map<string, PaymentRecord>();
  private readonly byTxRef = new Map<string, string>(); // txRef → paymentId
  private readonly clock: () => number;

  constructor(opts?: { clock?: () => number }) {
    this.clock = opts?.clock ?? Date.now;
  }

  async getById(paymentId: PaymentId): Promise<PaymentRecord | null> {
    const row = this.byId.get(paymentId);
    return row ? { ...row } : null;
  }

  async getByTxRef(txRef: string): Promise<PaymentRecord | null> {
    const id = this.byTxRef.get(txRef);
    if (!id) return null;
    const row = this.byId.get(id);
    return row ? { ...row } : null;
  }

  async create(input: CreatePaymentInput): Promise<PaymentRecord> {
    if (this.byId.has(input.paymentId)) {
      throw new PaymentRepoError(`Duplicate paymentId: ${input.paymentId}`);
    }
    if (this.byTxRef.has(input.txRef)) {
      throw new PaymentRepoError(`Duplicate txRef: ${input.txRef}`);
    }
    const now = this.clock();
    const record: PaymentRecord = {
      paymentId: input.paymentId,
      tenantId: input.tenantId,
      tenantPhone: input.tenantPhone,
      txRef: input.txRef,
      expectedAmountNgn: input.expectedAmountNgn,
      expectedMGrd: input.expectedMGrd,
      method: input.method,
      provider: input.provider,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
      failureReason: null,
    };
    this.byId.set(record.paymentId, record);
    this.byTxRef.set(record.txRef, record.paymentId);
    return { ...record };
  }

  async transitionStatus(input: TransitionInput): Promise<PaymentRecord> {
    const current = this.byId.get(input.paymentId);
    if (!current) {
      throw new PaymentNotFoundError(input.paymentId);
    }
    if (current.status !== 'PENDING') {
      throw new PaymentStateError(
        `Payment ${input.paymentId} is ${current.status}; expected PENDING for transition to ${input.nextStatus}`,
      );
    }
    const now = this.clock();
    const failureReason = input.nextStatus === 'FAILED' ? input.failureReason : null;
    const next: PaymentRecord = {
      ...current,
      status: input.nextStatus as PaymentStatus,
      updatedAt: now,
      resolvedAt: now,
      failureReason,
    };
    this.byId.set(input.paymentId, next);
    return { ...next };
  }

  async listStalePending(input: ListStalePendingInput): Promise<PaymentRecord[]> {
    const limit = input.limit ?? 1000;
    const result: PaymentRecord[] = [];
    for (const row of this.byId.values()) {
      if (row.status === 'PENDING' && row.createdAt < input.olderThan) {
        result.push({ ...row });
      }
    }
    // Stable sort by createdAt ascending — oldest first
    result.sort((a, b) => a.createdAt - b.createdAt);
    return result.slice(0, limit);
  }

  /** Test helper. */
  size(): number {
    return this.byId.size;
  }
}
