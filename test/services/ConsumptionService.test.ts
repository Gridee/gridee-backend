import { describe, expect, it } from 'vitest';
import { HardwareLayerFactory, InMemoryEnergyBalanceRepository, TenantId } from '../../src/hal';
import { Phone } from '../../src/lib/phone';
import type { INotificationService, NotificationResult } from '../../src/notifications';
import { ConsumptionService } from '../../src/services/ConsumptionService';
import { InMemoryTenantDirectory, type ActiveTenant } from '../../src/services/ITenantDirectory';

// ─── Test fixtures ─────────────────────────────────────────────────────────

class FakeNotifications implements INotificationService {
  readonly events: { method: string; phone: Phone; arg?: unknown }[] = [];
  shouldFail = false;

  private result(): NotificationResult {
    return this.shouldFail
      ? { delivered: false, channelUsed: null, error: 'fake' }
      : { delivered: true, channelUsed: 'whatsapp' };
  }

  async sendLowBalanceAlert(phone: Phone, balance: number): Promise<NotificationResult> {
    this.events.push({ method: 'sendLowBalanceAlert', phone, arg: balance });
    return this.result();
  }
  async sendCutoffNotice(phone: Phone): Promise<NotificationResult> {
    this.events.push({ method: 'sendCutoffNotice', phone });
    return this.result();
  }
  async sendRestoredNotice(phone: Phone, balance: number): Promise<NotificationResult> {
    this.events.push({ method: 'sendRestoredNotice', phone, arg: balance });
    return this.result();
  }
  async sendPurchaseConfirmed(): Promise<NotificationResult> {
    return this.result();
  }
  async sendPaymentFailed(): Promise<NotificationResult> {
    return this.result();
  }
  async sendNewTenantAlert(): Promise<NotificationResult> {
    return this.result();
  }
  async sendWithdrawalInitiated(): Promise<NotificationResult> {
    return this.result();
  }
  async sendWithdrawalConfirmed(): Promise<NotificationResult> {
    return this.result();
  }
  async sendTenantRemoved(): Promise<{ landlord: NotificationResult; tenant: NotificationResult }> {
    return { landlord: this.result(), tenant: this.result() };
  }
}

interface Rig {
  service: ConsumptionService;
  hal: ReturnType<typeof HardwareLayerFactory.create>;
  repo: InMemoryEnergyBalanceRepository;
  directory: InMemoryTenantDirectory;
  notifications: FakeNotifications;
}

function makeRig(opts?: { lowBalanceThresholdMGrd?: number; concurrency?: number }): Rig {
  const repo = new InMemoryEnergyBalanceRepository({ clock: () => 1_700_000_000_000 });
  const hal = HardwareLayerFactory.create({ type: 'mock', repository: repo });
  const directory = new InMemoryTenantDirectory();
  const notifications = new FakeNotifications();
  const serviceOpts: ConstructorParameters<typeof ConsumptionService>[0] = {
    hal,
    directory,
    notifications,
  };
  if (opts?.lowBalanceThresholdMGrd !== undefined) {
    serviceOpts.lowBalanceThresholdMGrd = opts.lowBalanceThresholdMGrd;
  }
  if (opts?.concurrency !== undefined) {
    serviceOpts.concurrency = opts.concurrency;
  }
  const service = new ConsumptionService(serviceOpts);
  return { service, hal, repo, directory, notifications };
}

function seed(repo: InMemoryEnergyBalanceRepository, tenant: ActiveTenant, balanceMGrd: number, state: 'CONNECTED' | 'CUTOFF' = 'CONNECTED'): void {
  repo._seedForTest({
    tenantId: tenant.tenantId,
    balanceMGrd,
    state,
    lastUpdatedAt: 0,
  });
}

const T1: ActiveTenant = {
  tenantId: TenantId.of('t1'),
  phone: Phone.of('+2348031111111'),
  kwhPerHour: 0.5,
};
const T2: ActiveTenant = {
  tenantId: TenantId.of('t2'),
  phone: Phone.of('+2348032222222'),
  kwhPerHour: 0.5,
};

// ─── Empty / trivial cases ─────────────────────────────────────────────────

describe('ConsumptionService — trivial cases', () => {
  it('empty directory → no work', async () => {
    const { service } = makeRig();
    const result = await service.tick();
    expect(result.total).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.cutoffsApplied).toBe(0);
    expect(result.lowBalanceAlertsFired).toBe(0);
  });
});

// ─── Happy path: deduction without alert/cutoff ────────────────────────────

describe('ConsumptionService — happy deduction', () => {
  it('deducts 0.5 kWh from a tenant with plenty of balance', async () => {
    const { service, hal, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    seed(repo, T1, 5_000); // 5 GRD

    const result = await service.tick();

    expect(result.total).toBe(1);
    expect(result.processed).toBe(1);
    expect(result.cutoffsApplied).toBe(0);
    expect(result.lowBalanceAlertsFired).toBe(0);

    const status = await hal.getMeterStatus(T1.tenantId);
    expect(status.balanceMGrd).toBe(4_500);
    expect(notifications.events).toHaveLength(0);
  });
});

// ─── Skipping: already CUTOFF ─────────────────────────────────────────────

describe('ConsumptionService — skip CUTOFF', () => {
  it('skips tenants already in CUTOFF state', async () => {
    const { service, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    seed(repo, T1, 0, 'CUTOFF');

    const result = await service.tick();
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]!.skipReason).toBe('cutoff');
    expect(notifications.events).toHaveLength(0);
  });

  it('skips tenant_not_found gracefully', async () => {
    const { service, directory } = makeRig();
    directory.upsert(T1); // in directory but no balance row in repo
    const result = await service.tick();
    expect(result.skipped).toBe(1);
    expect(result.outcomes[0]!.skipReason).toBe('tenant_not_found');
  });
});

// ─── Low-balance threshold ─────────────────────────────────────────────────

describe('ConsumptionService — low-balance alert', () => {
  it('fires alert when crossing threshold downward (default 1000 mGRD)', async () => {
    const { service, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    // Balance 1200; this tick deducts 500 → lands at 700 (below 1000)
    seed(repo, T1, 1_200);

    const result = await service.tick();
    expect(result.lowBalanceAlertsFired).toBe(1);
    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]!.method).toBe('sendLowBalanceAlert');
    expect(notifications.events[0]!.arg).toBeCloseTo(0.7, 3);
  });

  it('does NOT fire alert when already below threshold (no downward crossing)', async () => {
    const { service, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    // Balance 800 (already below 1000), tick → 300 (still below)
    seed(repo, T1, 800);

    const result = await service.tick();
    expect(result.lowBalanceAlertsFired).toBe(0);
    expect(notifications.events).toHaveLength(0);
  });

  it('does NOT fire alert when balance stays above threshold', async () => {
    const { service, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    // Balance 5000, tick → 4500 (still above)
    seed(repo, T1, 5_000);

    const result = await service.tick();
    expect(result.lowBalanceAlertsFired).toBe(0);
    expect(notifications.events).toHaveLength(0);
  });

  it('respects custom threshold', async () => {
    const { service, repo, directory, notifications } = makeRig({ lowBalanceThresholdMGrd: 2_000 });
    directory.upsert(T1);
    // Tick will land at 4500; below 2000? no.
    seed(repo, T1, 5_000);
    const r1 = await service.tick();
    expect(r1.lowBalanceAlertsFired).toBe(0);

    // Now seed something that crosses 2000
    seed(repo, T1, 2_400); // → 1900, below 2000
    notifications.events.length = 0;
    const r2 = await service.tick();
    expect(r2.lowBalanceAlertsFired).toBe(1);
  });
});

// ─── Cutoff path ───────────────────────────────────────────────────────────

describe('ConsumptionService — cutoff', () => {
  it('crosses zero exactly: fires cutoff notice and flips relay', async () => {
    const { service, hal, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    seed(repo, T1, 500); // exactly one tick of 500 mGRD = 0.5 kWh

    const result = await service.tick();
    expect(result.cutoffsApplied).toBe(1);
    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]!.method).toBe('sendCutoffNotice');

    const status = await hal.getMeterStatus(T1.tenantId);
    expect(status.state).toBe('CUTOFF');
    expect(status.balanceMGrd).toBe(0);
  });

  it('partial deduction (insufficient balance): still cuts off', async () => {
    const { service, hal, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    seed(repo, T1, 200); // less than one tick (500)

    const result = await service.tick();
    expect(result.cutoffsApplied).toBe(1);
    expect(notifications.events.map((e) => e.method)).toEqual(['sendCutoffNotice']);
    expect(result.outcomes[0]!.crossedZero).toBe(true);
    expect(result.outcomes[0]!.mGrdDeducted).toBe(200);

    const status = await hal.getMeterStatus(T1.tenantId);
    expect(status.state).toBe('CUTOFF');
  });

  it('does NOT fire low-balance alert AND cutoff in the same tick', async () => {
    const { service, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    seed(repo, T1, 500); // crosses to zero

    await service.tick();
    // Only one notification: the cutoff. No low-balance alert (that branch is skipped on crossedZero).
    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]!.method).toBe('sendCutoffNotice');
  });

  it('cutoff still applied even if cutoff notification fails', async () => {
    const { service, hal, repo, directory, notifications } = makeRig();
    directory.upsert(T1);
    seed(repo, T1, 500);
    notifications.shouldFail = true;

    const result = await service.tick();
    expect(result.cutoffsApplied).toBe(1); // relay flipped despite notif failure
    expect(result.outcomes[0]!.cutoffNoticeFired).toBe(false);

    const status = await hal.getMeterStatus(T1.tenantId);
    expect(status.state).toBe('CUTOFF');
  });
});

// ─── Failure isolation ────────────────────────────────────────────────────

describe('ConsumptionService — failure isolation', () => {
  it('one tenant error does not block others', async () => {
    const { service, repo, directory } = makeRig();
    directory.upsert(T1); // not seeded → tenant_not_found
    directory.upsert(T2);
    seed(repo, T2, 5_000);

    const result = await service.tick();
    expect(result.total).toBe(2);
    expect(result.processed).toBe(1); // T2 succeeded
    expect(result.skipped).toBe(1); // T1 was tenant_not_found
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────

describe('ConsumptionService — concurrency', () => {
  it('processes many tenants under bounded concurrency', async () => {
    const { service, repo, directory } = makeRig({ concurrency: 5 });
    // Set up 50 tenants
    for (let i = 0; i < 50; i++) {
      const tenant: ActiveTenant = {
        tenantId: TenantId.of(`t${i}`),
        phone: Phone.of(`+234803${String(i).padStart(7, '0')}`),
        kwhPerHour: 0.5,
      };
      directory.upsert(tenant);
      seed(repo, tenant, 5_000);
    }

    const result = await service.tick();
    expect(result.total).toBe(50);
    expect(result.processed).toBe(50);
    // All balances should be 4500 now
    for (let i = 0; i < 50; i++) {
      const row = await repo.get(TenantId.of(`t${i}`));
      expect(row?.balanceMGrd).toBe(4_500);
    }
  });

  it('preserves outcome ordering matching directory order', async () => {
    const { service, repo, directory } = makeRig({ concurrency: 3 });
    directory.upsert(T1);
    directory.upsert(T2);
    seed(repo, T1, 5_000);
    seed(repo, T2, 500); // T2 crosses zero

    const result = await service.tick();
    // The order of outcomes should match directory.listActive() order
    expect(result.outcomes.map((o) => o.tenantId)).toEqual([T1.tenantId, T2.tenantId]);
    expect(result.outcomes[0]!.crossedZero).toBe(false); // T1 happy
    expect(result.outcomes[1]!.crossedZero).toBe(true); // T2 cutoff
  });
});

// ─── End-to-end: multiple ticks of consumption + thresholds ─────────────────

describe('ConsumptionService — multi-tick simulation', () => {
  it('simulates 12 hourly ticks: alert → no-repeat → cutoff', async () => {
    // Tenant starts with 6000 mGRD = 6 GRD = 12 hours of power.
    // Tick 1-9: above threshold, no alerts.
    // Tick 10: balance was 1500 → ticks to 1000 → below threshold? actually we
    //          set threshold = 1000, so 1000 is NOT below 1000. Use a tighter setup:
    // We'll use threshold = 1500. Then:
    //   - Tick 1: 6000 → 5500
    //   - Tick 2: 5500 → 5000
    //   ... linear decrement of 500 per tick.
    //   - Tick 10: 1500 → 1000 — crosses below threshold (DOWNWARD). Alert!
    //   - Tick 11: 1000 → 500 — was already below, no second alert.
    //   - Tick 12: 500 → 0 — cutoff.
    const { service, repo, directory, notifications } = makeRig({ lowBalanceThresholdMGrd: 1_500 });
    directory.upsert(T1);
    seed(repo, T1, 6_000);

    const events: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await service.tick();
      const e = r.outcomes[0]!;
      if (e.lowBalanceAlertFired) events.push(`tick${i + 1}:lowBalance`);
      if (e.cutoffNoticeFired) events.push(`tick${i + 1}:cutoff`);
    }

    expect(events).toEqual(['tick10:lowBalance', 'tick12:cutoff']);

    // Verify directly from repo:
    const row = await repo.get(T1.tenantId);
    expect(row?.state).toBe('CUTOFF');
    expect(row?.balanceMGrd).toBe(0);

    // Tick 13 should now SKIP because state is CUTOFF
    const r13 = await service.tick();
    expect(r13.skipped).toBe(1);
    expect(r13.outcomes[0]!.skipReason).toBe('cutoff');
    expect(notifications.events.filter((e) => e.method === 'sendCutoffNotice')).toHaveLength(1); // not duplicated
  });
});
