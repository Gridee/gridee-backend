import * as cron from 'node-cron';
import { logger } from '../lib/logger';
import type { PaymentExpiryService } from '../services';

export interface PaymentExpiryEngineOptions {
  service: PaymentExpiryService;
  /**
   * Cron schedule. Default: every 5 minutes (`*\/5 * * * *`).
   * The TTL is 15 minutes, so a 5-min cadence means a stale payment is
   * detected within at most 5 minutes of crossing the threshold.
   */
  schedule?: string;
  /** If true, run a sweep once immediately at startup. Default false. */
  runOnStart?: boolean;
}

export interface PaymentExpiryEngineHandle {
  stop(): void;
  triggerNow(): Promise<void>;
}

/**
 * Wires PaymentExpiryService.sweep() to a cron schedule.
 *
 * Same guarantees as consumptionEngine:
 *   - Skips overlapping fires (slow sweep won't stack)
 *   - Survives service throw (cron continues)
 *   - Idempotent stop()
 *   - Schedule validated at construction
 */
export function startPaymentExpiryEngine(
  opts: PaymentExpiryEngineOptions,
): PaymentExpiryEngineHandle {
  const schedule = opts.schedule ?? '*/5 * * * *';
  const log = logger.child({ component: 'pendingPaymentExpiry' });

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: "${schedule}"`);
  }

  let running = false;

  const runOnce = async (): Promise<void> => {
    if (running) {
      log.warn('Previous sweep still running; skipping this fire');
      return;
    }
    running = true;
    try {
      const result = await opts.service.sweep();
      log.info(
        {
          candidates: result.candidates,
          expired: result.expired,
          alreadyResolved: result.alreadyResolved,
          errored: result.errored,
          notificationsSent: result.notificationsSent,
          durationMs: result.durationMs,
        },
        'Sweep complete',
      );
    } catch (err) {
      log.error(
        { err: (err as Error).message, stack: (err as Error).stack },
        'Sweep threw — cron will continue on schedule',
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

  log.info({ schedule }, 'Payment expiry engine started');

  if (opts.runOnStart) {
    runOnce().catch(() => undefined);
  }

  return {
    stop(): void {
      task.stop();
      log.info('Payment expiry engine stopped');
    },
    triggerNow(): Promise<void> {
      return runOnce();
    },
  };
}
