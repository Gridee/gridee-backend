import { describe, expect, it, vi } from 'vitest';
import { startConsumptionEngine } from '../../src/jobs/consumptionEngine';
import type { ConsumptionService, TickRunResult } from '../../src/services';

function makeFakeService(tickImpl?: () => Promise<TickRunResult>): {
  service: ConsumptionService;
  tickCalls: number;
} {
  let tickCalls = 0;
  const tick = tickImpl ?? (async (): Promise<TickRunResult> => ({
    total: 0,
    processed: 0,
    skipped: 0,
    errored: 0,
    lowBalanceAlertsFired: 0,
    cutoffsApplied: 0,
    outcomes: [],
    durationMs: 1,
  }));
  const service = {
    tick: async () => {
      tickCalls++;
      return tick();
    },
  } as unknown as ConsumptionService;
  return {
    service,
    get tickCalls(): number {
      return tickCalls;
    },
  };
}

describe('startConsumptionEngine', () => {
  it('throws on invalid cron schedule', () => {
    const { service } = makeFakeService();
    expect(() => startConsumptionEngine({ service, schedule: 'not-a-cron' })).toThrow();
  });

  it('triggerNow runs the service.tick once', async () => {
    const fake = makeFakeService();
    const handle = startConsumptionEngine({ service: fake.service });
    await handle.triggerNow();
    expect(fake.tickCalls).toBe(1);
    handle.stop();
  });

  it('skips concurrent fires when a previous tick is still running', async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const fake = makeFakeService(async () => {
      await firstDone;
      return {
        total: 0,
        processed: 0,
        skipped: 0,
        errored: 0,
        lowBalanceAlertsFired: 0,
        cutoffsApplied: 0,
        outcomes: [],
        durationMs: 1,
      };
    });

    const handle = startConsumptionEngine({ service: fake.service });

    // Kick off the slow first tick
    const t1 = handle.triggerNow();

    // Give it a microtask to enter the function and flip `running = true`
    await Promise.resolve();
    await Promise.resolve();

    // Now fire a second tick while the first is still in flight — should skip
    const t2 = handle.triggerNow();
    await t2;
    expect(fake.tickCalls).toBe(1); // second was skipped

    // Release the first
    resolveFirst();
    await t1;
    expect(fake.tickCalls).toBe(1); // first counted as one call

    // Now a fresh tick can run
    await handle.triggerNow();
    expect(fake.tickCalls).toBe(2);

    handle.stop();
  });

  it('does NOT crash when service.tick throws', async () => {
    const fake = makeFakeService(async () => {
      throw new Error('boom');
    });
    const handle = startConsumptionEngine({ service: fake.service });
    await expect(handle.triggerNow()).resolves.toBeUndefined();
    expect(fake.tickCalls).toBe(1);
    handle.stop();
  });

  it('runOnStart fires once immediately', async () => {
    const fake = makeFakeService();
    const handle = startConsumptionEngine({ service: fake.service, runOnStart: true });
    // Wait a microtask for the runOnStart promise to resolve
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.tickCalls).toBe(1);
    handle.stop();
  });

  it('stop is idempotent', () => {
    const fake = makeFakeService();
    const handle = startConsumptionEngine({ service: fake.service });
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });
});

void vi; // satisfy unused import lint if vi isn't actually used
