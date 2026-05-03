import { logger } from '../lib/logger';
import {
  toGrd,
  type IHardwareLayer,
  type TenantId,
} from '../hal';
import { TenantNotFoundError } from '../hal';
import type { INotificationService } from '../notifications';
import type { ActiveTenant, ITenantDirectory } from './ITenantDirectory';

export interface ConsumptionServiceOptions {
  hal: IHardwareLayer;
  directory: ITenantDirectory;
  notifications: INotificationService;
  /**
   * Threshold in milli-GRD below which a low-balance alert fires.
   * Default 1000 mGRD = 1 GRD = 1 kWh (≈ 2 hours of usage at 0.5 kWh/h).
   */
  lowBalanceThresholdMGrd?: number;
  /**
   * Bound on parallel per-tenant work in one tick. Default 10.
   * Higher = faster batch but more load on backend infra; lower = slower
   * but gentler.
   */
  concurrency?: number;
}

/**
 * Per-tenant tick outcome. Returned from `tickOne` and aggregated by `tick`.
 */
export interface TickOutcome {
  tenantId: TenantId;
  /** Was the tenant skipped (already CUTOFF, not in CONNECTED state)? */
  skipped: boolean;
  skipReason?: 'cutoff' | 'tenant_not_found' | 'error';
  /** mGRD actually deducted (0 if skipped). */
  mGrdDeducted: number;
  /** Final balance after tick (mGRD). */
  balanceAfterMGrd: number;
  /** Did this tick cross zero? (triggers cutoff) */
  crossedZero: boolean;
  /** Did we fire a low-balance alert? */
  lowBalanceAlertFired: boolean;
  /** Did we fire a cutoff notice? */
  cutoffNoticeFired: boolean;
  /** Was the relay flipped to CUTOFF this tick? */
  cutoffApplied: boolean;
  /** Error encountered during processing, if any. */
  error?: string;
}

/**
 * Aggregate result for one full cron run.
 */
export interface TickRunResult {
  total: number;
  processed: number;
  skipped: number;
  errored: number;
  lowBalanceAlertsFired: number;
  cutoffsApplied: number;
  /** Per-tenant outcomes — useful for tests & detailed logs. */
  outcomes: TickOutcome[];
  /** Wall-clock duration in ms. */
  durationMs: number;
}

/**
 * The consumption engine.
 *
 * Called by the cron job (jobs/consumptionEngine.ts) once per scheduled
 * interval. For each active tenant in CONNECTED state:
 *
 *   1. Deduct the tenant's hourly kWh allotment via the HAL
 *   2. If `crossedZero` → fire cutoff notice + flip relay
 *   3. Else if balance dropped below threshold AND we haven't already
 *      alerted the user → fire low-balance alert
 *
 * Hysteresis: the low-balance alert tracks whether the threshold was crossed
 * *downward* in this tick. We don't have a cross-tick "already alerted" flag
 * yet (would need a column on energy_balances) — for MVP, we err on the side
 * of one alert per crossing. If the user tops up and consumes back down,
 * they get another alert. Acceptable tradeoff.
 *
 * Failure isolation:
 *   - HAL error for tenant T → log, mark errored, continue with next tenant
 *   - Notification failure for tenant T → log, but cutoff still flips
 *   - Cutoff failure for tenant T → log; user keeps power for one more tick
 *     (not ideal but bounded; next tick retries; balance is already 0)
 */
export class ConsumptionService {
  private readonly hal: IHardwareLayer;
  private readonly directory: ITenantDirectory;
  private readonly notifications: INotificationService;
  private readonly lowBalanceThresholdMGrd: number;
  private readonly concurrency: number;
  private readonly log: typeof logger;

  constructor(opts: ConsumptionServiceOptions) {
    this.hal = opts.hal;
    this.directory = opts.directory;
    this.notifications = opts.notifications;
    this.lowBalanceThresholdMGrd = opts.lowBalanceThresholdMGrd ?? 1000; // 1 GRD
    this.concurrency = Math.max(1, opts.concurrency ?? 10);
    this.log = logger.child({ component: 'ConsumptionService' });
  }

  /**
   * Run one tick across all active tenants.
   * The cron job calls this; nothing else should.
   */
  async tick(): Promise<TickRunResult> {
    const start = Date.now();
    const tenants = await this.directory.listActive();
    this.log.info({ tenantCount: tenants.length }, 'Tick started');

    const outcomes = await runWithConcurrency(
      tenants,
      this.concurrency,
      (tenant) => this.tickOne(tenant),
    );

    const result: TickRunResult = {
      total: tenants.length,
      processed: outcomes.filter((o) => !o.skipped && !o.error).length,
      skipped: outcomes.filter((o) => o.skipped && o.skipReason !== 'error').length,
      errored: outcomes.filter((o) => o.error !== undefined).length,
      lowBalanceAlertsFired: outcomes.filter((o) => o.lowBalanceAlertFired).length,
      cutoffsApplied: outcomes.filter((o) => o.cutoffApplied).length,
      outcomes,
      durationMs: Date.now() - start,
    };

    this.log.info(
      {
        ...result,
        // Don't dump per-tenant outcomes into a single log line
        outcomes: undefined,
      },
      'Tick completed',
    );

    return result;
  }

  /**
   * Process one tenant. Public for testing. Never throws — errors are
   * captured into the TickOutcome.
   */
  async tickOne(tenant: ActiveTenant): Promise<TickOutcome> {
    const base: TickOutcome = {
      tenantId: tenant.tenantId,
      skipped: false,
      mGrdDeducted: 0,
      balanceAfterMGrd: 0,
      crossedZero: false,
      lowBalanceAlertFired: false,
      cutoffNoticeFired: false,
      cutoffApplied: false,
    };

    try {
      // 1. Read status — skip if CUTOFF (no power = no consumption)
      const status = await this.hal.getMeterStatus(tenant.tenantId);
      if (status.state === 'CUTOFF') {
        return { ...base, skipped: true, skipReason: 'cutoff', balanceAfterMGrd: status.balanceMGrd };
      }

      // 2. Deduct
      const deduction = await this.hal.deductConsumption(tenant.tenantId, tenant.kwhPerHour);
      base.mGrdDeducted = deduction.mGrdDeducted;
      base.balanceAfterMGrd = deduction.balanceAfterMGrd;
      base.crossedZero = deduction.crossedZero;

      // 3. Branch: cross zero (cutoff path) vs above-zero (low-balance path)
      if (deduction.crossedZero) {
        // 3a. Fire cutoff notice (does not throw — non-blocking)
        const notif = await this.notifications.sendCutoffNotice(tenant.phone);
        base.cutoffNoticeFired = notif.delivered;

        // 3b. Flip relay (HAL.cutOff)
        try {
          const cut = await this.hal.cutOff(tenant.tenantId);
          base.cutoffApplied = cut.changed;
        } catch (err) {
          // Relay flip failed — log and surface the error but DO NOT throw.
          // The tenant got their cutoff notice; relay will be retried next tick.
          this.log.error(
            { tenantId: tenant.tenantId, err: (err as Error).message },
            'cutOff failed after crossedZero — will retry on next tick',
          );
          base.error = `cutOff failed: ${(err as Error).message}`;
        }
      } else if (
        // Crossed below threshold this tick (downward)
        deduction.balanceAfterMGrd < this.lowBalanceThresholdMGrd &&
        deduction.balanceAfterMGrd + deduction.mGrdDeducted >= this.lowBalanceThresholdMGrd
      ) {
        const balanceGrd = toGrd(deduction.balanceAfterMGrd);
        const notif = await this.notifications.sendLowBalanceAlert(tenant.phone, balanceGrd);
        base.lowBalanceAlertFired = notif.delivered;
      }

      return base;
    } catch (err) {
      // Don't fail the whole batch over one tenant
      const message = (err as Error).message;
      if (err instanceof TenantNotFoundError) {
        this.log.warn(
          { tenantId: tenant.tenantId },
          'Tenant has no balance row; will be created on first mint',
        );
        return { ...base, skipped: true, skipReason: 'tenant_not_found' };
      }
      this.log.error({ tenantId: tenant.tenantId, err: message }, 'tickOne failed');
      return { ...base, skipped: true, skipReason: 'error', error: message };
    }
  }
}

// ─── Concurrency helper — bounded parallelism ──────────────────────────────

/**
 * Run `fn` over `items` with at most `limit` running concurrently.
 * Preserves output order matching input order.
 */
async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
