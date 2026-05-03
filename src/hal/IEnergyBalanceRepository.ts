import { HalArgumentError } from './errors';
import { type MeterState, type TenantId } from './types';

/**
 * Persisted balance row. The repository is the source of truth for ALL
 * tenant balance state. The HAL is logic; the repo is data.
 *
 * `balanceMGrd` is integer milli-GRD. It MUST be stored as a 64-bit integer
 * column in production (Postgres `bigint`). Using `numeric` would invite
 * floating drift back in.
 */
export interface EnergyBalanceRow {
  tenantId: TenantId;
  balanceMGrd: number;
  state: MeterState;
  /** Epoch ms. */
  lastUpdatedAt: number;
}

/**
 * Data layer for energy balances. Production impl will be PostgreSQL backed
 * by the `energy_balances` table; this interface lets us unit-test the HAL
 * without a database.
 *
 * IMPORTANT: implementations MUST guarantee atomicity of `applyDelta` —
 * the read-modify-write window is the lock seam. Postgres impl will use
 * `UPDATE ... WHERE tenant_id = $1 RETURNING *` in a single statement.
 */
export interface IEnergyBalanceRepository {
  /** Returns null if no row exists for this tenant. */
  get(tenantId: TenantId): Promise<EnergyBalanceRow | null>;

  /**
   * Create or replace the row. Used at tenant onboarding to seed a zero
   * row, and as a safety net (most callers should use applyDelta).
   */
  upsert(row: EnergyBalanceRow): Promise<void>;

  /**
   * Atomically:
   *   1. Read the current row (or treat as 0 / CUTOFF if absent? See `createIfMissing`)
   *   2. Apply delta (signed integer mGRD)
   *   3. Clamp final balance at 0
   *   4. Optionally update state
   *   5. Bump lastUpdatedAt
   *   6. Write back
   *
   * Returns the row AFTER the change, or null if `tenantId` doesn't exist
   * AND `createIfMissing` is false.
   *
   * `delta` may be negative (consumption) or positive (mint). Returning
   * `clampedToZero=true` indicates the deduction would have gone negative.
   */
  applyDelta(input: ApplyDeltaInput): Promise<ApplyDeltaResult | null>;

  /**
   * Atomically set state without changing balance. Returns true if state
   * actually changed; false if it was already in the target state or the
   * tenant doesn't exist.
   */
  setState(tenantId: TenantId, nextState: MeterState): Promise<{
    changed: boolean;
    row: EnergyBalanceRow | null;
  }>;
}

export interface ApplyDeltaInput {
  tenantId: TenantId;
  /** Signed mGRD to add (positive = mint, negative = consume). MUST be integer. */
  deltaMGrd: number;
  /**
   * If true, create a row at zero balance + CUTOFF before applying delta.
   * Use this on first mint for a freshly-onboarded tenant.
   */
  createIfMissing: boolean;
  /** If provided, also update state to this value (atomically). */
  setState?: MeterState;
}

export interface ApplyDeltaResult {
  row: EnergyBalanceRow;
  /** True if the original delta would have made balance < 0. */
  clampedToZero: boolean;
  /** mGRD actually applied (may differ from requested when clamped). */
  appliedMGrd: number;
  /** Balance BEFORE the delta. */
  balanceBeforeMGrd: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory repository — for dev / tests / single-process MVP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory implementation. Suitable for tests and the MVP demo. Production
 * deployments use the (future) PostgresEnergyBalanceRepository.
 *
 * Concurrency: a per-tenant async mutex serializes applyDelta + setState +
 * upsert calls so the read-modify-write window is atomic. A single Map +
 * single-threaded JS only protects against interleaved Promise resolution,
 * not multi-process — but multi-process safety is the Postgres impl's job.
 */
export class InMemoryEnergyBalanceRepository implements IEnergyBalanceRepository {
  private readonly rows = new Map<string, EnergyBalanceRow>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly clock: () => number;

  constructor(opts?: { clock?: () => number }) {
    this.clock = opts?.clock ?? Date.now;
  }

  async get(tenantId: TenantId): Promise<EnergyBalanceRow | null> {
    const row = this.rows.get(tenantId);
    return row ? { ...row } : null;
  }

  async upsert(row: EnergyBalanceRow): Promise<void> {
    if (!Number.isInteger(row.balanceMGrd) || row.balanceMGrd < 0) {
      throw new HalArgumentError(`balanceMGrd must be a non-negative integer, got ${row.balanceMGrd}`);
    }
    return this.withLock(row.tenantId, () => {
      this.rows.set(row.tenantId, { ...row });
    });
  }

  async applyDelta(input: ApplyDeltaInput): Promise<ApplyDeltaResult | null> {
    if (!Number.isInteger(input.deltaMGrd)) {
      throw new HalArgumentError(`deltaMGrd must be integer, got ${input.deltaMGrd}`);
    }
    return this.withLock(input.tenantId, () => {
      let row = this.rows.get(input.tenantId);
      if (!row) {
        if (!input.createIfMissing) return null;
        row = { tenantId: input.tenantId, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: this.clock() };
      }

      const balanceBefore = row.balanceMGrd;
      const requested = input.deltaMGrd;
      const proposed = balanceBefore + requested;
      const clampedToZero = proposed < 0;
      const finalBalance = clampedToZero ? 0 : proposed;
      const appliedMGrd = finalBalance - balanceBefore; // signed

      const next: EnergyBalanceRow = {
        tenantId: row.tenantId,
        balanceMGrd: finalBalance,
        state: input.setState ?? row.state,
        lastUpdatedAt: this.clock(),
      };
      this.rows.set(input.tenantId, next);

      return {
        row: { ...next },
        clampedToZero,
        appliedMGrd,
        balanceBeforeMGrd: balanceBefore,
      };
    });
  }

  async setState(
    tenantId: TenantId,
    nextState: MeterState,
  ): Promise<{ changed: boolean; row: EnergyBalanceRow | null }> {
    return this.withLock(tenantId, () => {
      const row = this.rows.get(tenantId);
      if (!row) return { changed: false, row: null };
      if (row.state === nextState) return { changed: false, row: { ...row } };
      const next: EnergyBalanceRow = { ...row, state: nextState, lastUpdatedAt: this.clock() };
      this.rows.set(tenantId, next);
      return { changed: true, row: { ...next } };
    });
  }

  /** Test helper. */
  size(): number {
    return this.rows.size;
  }

  /** Test helper — bypass the lock for setup. */
  _seedForTest(row: EnergyBalanceRow): void {
    this.rows.set(row.tenantId, { ...row });
  }

  // ─── Internal: per-tenant async mutex ────────────────────────────────
  //
  // A simple chain-based mutex: every new operation appends itself to a
  // tenant-keyed promise chain. We never explicitly unlock — the chain
  // naturally moves on as each op resolves. The chain head is updated on
  // every call to keep new arrivals tied to the latest pending op.

  private async withLock<T>(tenantId: TenantId, fn: () => T | Promise<T>): Promise<T> {
    const prior = this.locks.get(tenantId) ?? Promise.resolve();
    // Wrap fn so that even if it throws, the chain (next) still resolves
    // — otherwise a failed op would block all future ops for this tenant.
    let resolveOuter!: () => void;
    const next = new Promise<void>((res) => {
      resolveOuter = res;
    });
    this.locks.set(tenantId, next);

    try {
      await prior;
      return await fn();
    } finally {
      resolveOuter();
    }
  }
}
