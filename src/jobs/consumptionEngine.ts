import * as cron from 'node-cron';
import { logger } from '../lib/logger';
import type { ConsumptionService } from '../services';

export interface ConsumptionEngineOptions {
  service: ConsumptionService;
  /**
   * Cron schedule. Default: every hour at minute 0 (`0 * * * *`).
   * For tests / demos: use a faster cadence like `*\/2 * * * * *` (every 2s, 6-field).
   */
  schedule?: string;
  /**
   * If true, run a tick once immediately at startup. Default false.
   * Useful for demos so you don't have to wait an hour.
   */
  runOnStart?: boolean;
}

export interface ConsumptionEngineHandle {
  /** Stop the cron — releases the timer. Idempotent. */
  stop(): void;
  /** Manually trigger a tick — useful for tests / demos. */
  triggerNow(): Promise<void>;
}

/**
 * Wires ConsumptionService.tick() to a cron schedule.
 *
 * Failure isolation: if `tick()` throws, the cron continues firing on
 * schedule. We log the failure but never let it propagate up to crash the
 * process.
 *
 * Concurrency: if a previous tick is still running when the next fire
 * arrives, the new fire is SKIPPED with a warning (logged). This matters
 * for the MVP because each tick reads ALL tenants — a slow run shouldn't
 * stack up overlapping deductions.
 */
export function startConsumptionEngine(opts: ConsumptionEngineOptions): ConsumptionEngineHandle {
  const schedule = opts.schedule ?? '0 * * * *';
  const log = logger.child({ component: 'consumptionEngine' });

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: "${schedule}"`);
  }

  let running = false;

  const runOnce = async (): Promise<void> => {
    if (running) {
      log.warn('Previous tick still running; skipping this fire');
      return;
    }
    running = true;
    try {
      const result = await opts.service.tick();
      log.info(
        {
          total: result.total,
          processed: result.processed,
          skipped: result.skipped,
          errored: result.errored,
          lowBalanceAlertsFired: result.lowBalanceAlertsFired,
          cutoffsApplied: result.cutoffsApplied,
          durationMs: result.durationMs,
        },
        'Tick complete',
      );
    } catch (err) {
      log.error(
        { err: (err as Error).message, stack: (err as Error).stack },
        'Tick threw — cron will continue on schedule',
      );
    } finally {
      running = false;
    }
  };

  const task = cron.schedule(schedule, () => {
    runOnce().catch((err: unknown) => {
      log.error({ err: (err as Error).message }, 'runOnce promise rejected');
    });
  });

  log.info({ schedule }, 'Consumption engine started');

  if (opts.runOnStart) {
    // Fire immediately, but without blocking the caller
    runOnce().catch(() => undefined);
  }

  return {
    stop(): void {
      task.stop();
      log.info('Consumption engine stopped');
    },
    triggerNow(): Promise<void> {
      return runOnce();
    },
  };
}
