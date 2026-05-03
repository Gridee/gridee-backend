import { describe, expect, it } from 'vitest';
import { startPaymentExpiryEngine } from '../../src/jobs/pendingPaymentExpiry';
import type { ExpirySweepResult, PaymentExpiryService } from '../../src/services';

function makeFakeService(sweepImpl?: () => Promise<ExpirySweepResult>): {
  service: PaymentExpiryService;
  readonly callCount: number;
} {
  let count = 0;
  const sweep = sweepImpl ?? (async (): Promise<ExpirySweepResult> => ({
    candidates: 0,
    expired: 0,
    alreadyResolved: 0,
    errored: 0,
    notificationsSent: 0,
    outcomes: [],
    durationMs: 1,
  }));
  const service = {
    sweep: async () => {
      count++;
      return sweep();
    },
  } as unknown as PaymentExpiryService;
  return {
    service,
    get callCount(): number {
      return count;
    },
  };
}

describe('startPaymentExpiryEngine', () => {
  it('throws on invalid cron schedule', () => {
    const { service } = makeFakeService();
    expect(() => startPaymentExpiryEngine({ service, schedule: 'not-a-cron' })).toThrow();
  });

  it('triggerNow runs sweep once', async () => {
    const fake = makeFakeService();
    const handle = startPaymentExpiryEngine({ service: fake.service });
    await handle.triggerNow();
    expect(fake.callCount).toBe(1);
    handle.stop();
  });

  it('skips overlapping fires', async () => {
    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const fake = makeFakeService(async () => {
      await firstDone;
      return {
        candidates: 0,
        expired: 0,
        alreadyResolved: 0,
        errored: 0,
        notificationsSent: 0,
        outcomes: [],
        durationMs: 1,
      };
    });
    const handle = startPaymentExpiryEngine({ service: fake.service });
    const t1 = handle.triggerNow();
    await Promise.resolve();
    await Promise.resolve();
    const t2 = handle.triggerNow();
    await t2;
    expect(fake.callCount).toBe(1); // second was skipped
    resolveFirst();
    await t1;
    expect(fake.callCount).toBe(1);
    await handle.triggerNow();
    expect(fake.callCount).toBe(2);
    handle.stop();
  });

  it('does not crash when sweep throws', async () => {
    const fake = makeFakeService(async () => {
      throw new Error('boom');
    });
    const handle = startPaymentExpiryEngine({ service: fake.service });
    await expect(handle.triggerNow()).resolves.toBeUndefined();
    expect(fake.callCount).toBe(1);
    handle.stop();
  });

  it('runOnStart fires once at boot', async () => {
    const fake = makeFakeService();
    const handle = startPaymentExpiryEngine({ service: fake.service, runOnStart: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.callCount).toBe(1);
    handle.stop();
  });

  it('stop is idempotent', () => {
    const fake = makeFakeService();
    const handle = startPaymentExpiryEngine({ service: fake.service });
    handle.stop();
    expect(() => handle.stop()).not.toThrow();
  });
});
