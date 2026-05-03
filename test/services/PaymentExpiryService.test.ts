import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '../../src/hal';
import { Phone } from '../../src/lib/phone';
import type { INotificationService, NotificationResult } from '../../src/notifications';
import {
  InMemoryPaymentRepository,
  PaymentId,
} from '../../src/repositories';
import { PaymentExpiryService } from '../../src/services/PaymentExpiryService';

const TENANT = TenantId.of('t1');
const PHONE = Phone.of('+2348031234567');

class FakeNotifications implements INotificationService {
  readonly events: { method: string; phone: Phone; reason?: string }[] = [];
  shouldFail = false;
  private result(): NotificationResult {
    return this.shouldFail
      ? { delivered: false, channelUsed: null, error: 'fake' }
      : { delivered: true, channelUsed: 'whatsapp' };
  }
  async sendLowBalanceAlert(): Promise<NotificationResult> { return this.result(); }
  async sendCutoffNotice(): Promise<NotificationResult> { return this.result(); }
  async sendRestoredNotice(): Promise<NotificationResult> { return this.result(); }
  async sendPurchaseConfirmed(): Promise<NotificationResult> { return this.result(); }
  async sendPaymentFailed(phone: Phone, reason: string): Promise<NotificationResult> {
    this.events.push({ method: 'sendPaymentFailed', phone, reason });
    return this.result();
  }
  async sendNewTenantAlert(): Promise<NotificationResult> { return this.result(); }
  async sendWithdrawalInitiated(): Promise<NotificationResult> { return this.result(); }
  async sendWithdrawalConfirmed(): Promise<NotificationResult> { return this.result(); }
  async sendTenantRemoved(): Promise<{ landlord: NotificationResult; tenant: NotificationResult }> {
    return { landlord: this.result(), tenant: this.result() };
  }
}

interface Rig {
  service: PaymentExpiryService;
  repo: InMemoryPaymentRepository;
  notifications: FakeNotifications;
  setNow(t: number): void;
}

function makeRig(opts?: {
  ttlMs?: number;
  notifyOnExpiry?: boolean;
  initialClock?: number;
}): Rig {
  let now = opts?.initialClock ?? 1_000_000;
  const repo = new InMemoryPaymentRepository({ clock: () => now });
  const notifications = new FakeNotifications();

  const serviceOpts: ConstructorParameters<typeof PaymentExpiryService>[0] = {
    paymentRepo: repo,
    notifications,
    clock: () => now,
  };
  if (opts?.ttlMs !== undefined) serviceOpts.ttlMs = opts.ttlMs;
  if (opts?.notifyOnExpiry !== undefined) serviceOpts.notifyOnExpiry = opts.notifyOnExpiry;
  const service = new PaymentExpiryService(serviceOpts);

  return {
    service,
    repo,
    notifications,
    setNow(t: number): void {
      now = t;
    },
  };
}

async function seedPayment(repo: InMemoryPaymentRepository, txRef: string): Promise<PaymentId> {
  const pid = PaymentId.of(`pay_${txRef}`);
  await repo.create({
    paymentId: pid,
    tenantId: TENANT,
    tenantPhone: PHONE,
    txRef,
    expectedAmountNgn: 5000,
    expectedMGrd: 4000,
    method: 'BANK_TRANSFER',
    provider: 'flutterwave',
  });
  return pid;
}

// ─── Trivial cases ─────────────────────────────────────────────────────────

describe('PaymentExpiryService — trivial', () => {
  it('returns zero-everything when no candidates', async () => {
    const { service } = makeRig();
    const result = await service.sweep();
    expect(result.candidates).toBe(0);
    expect(result.expired).toBe(0);
    expect(result.outcomes).toEqual([]);
  });
});

// ─── Happy path: stale rows expire ────────────────────────────────────────

describe('PaymentExpiryService — expires stale PENDING rows', () => {
  it('expires only rows older than ttl', async () => {
    const { service, repo, setNow, notifications } = makeRig({ ttlMs: 15 * 60 * 1000 });

    // Create 3 payments at t=0, t=10min, t=20min (all PENDING)
    setNow(0);
    await seedPayment(repo, 'TX_a');
    setNow(10 * 60 * 1000);
    await seedPayment(repo, 'TX_b');
    setNow(20 * 60 * 1000);
    await seedPayment(repo, 'TX_c');

    // Sweep at t=20min: TX_a was created at t=0 (20 min ago) → stale.
    // TX_b at t=10min (10 min ago) → not stale.
    // TX_c at t=20min (now) → not stale.
    const result = await service.sweep();
    expect(result.candidates).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.outcomes[0]!.txRef).toBe('TX_a');

    // Verify state
    const a = await repo.getByTxRef('TX_a');
    expect(a!.status).toBe('EXPIRED');
    const b = await repo.getByTxRef('TX_b');
    expect(b!.status).toBe('PENDING');
    const c = await repo.getByTxRef('TX_c');
    expect(c!.status).toBe('PENDING');

    // Notification was sent for the expired one
    expect(notifications.events).toHaveLength(1);
    expect(notifications.events[0]!.method).toBe('sendPaymentFailed');
    expect(notifications.events[0]!.reason).toMatch(/timed out/i);
  });

  it('expires multiple stale rows in one sweep', async () => {
    const { service, repo, setNow } = makeRig({ ttlMs: 15 * 60 * 1000 });
    setNow(0);
    await seedPayment(repo, 'TX_1');
    await seedPayment(repo, 'TX_2');
    await seedPayment(repo, 'TX_3');
    setNow(20 * 60 * 1000);
    const result = await service.sweep();
    expect(result.expired).toBe(3);
    for (const ref of ['TX_1', 'TX_2', 'TX_3']) {
      const row = await repo.getByTxRef(ref);
      expect(row!.status).toBe('EXPIRED');
    }
  });
});

// ─── Race with webhook (alreadyResolved) ──────────────────────────────────

describe('PaymentExpiryService — race with webhook', () => {
  it('reports alreadyResolved when row was confirmed between list and transition', async () => {
    const { service, repo, setNow } = makeRig({ ttlMs: 15 * 60 * 1000 });
    setNow(0);
    const pid = await seedPayment(repo, 'TX_raced');

    // Advance past TTL so it's listed as stale
    setNow(20 * 60 * 1000);

    // Simulate the race: webhook arrived first and confirmed the payment
    // BEFORE the sweep transitions it. We do this by spying transitionStatus.
    const real = repo.transitionStatus.bind(repo);
    const spy = vi.spyOn(repo, 'transitionStatus').mockImplementationOnce(async (input) => {
      // Webhook racing in: confirm the row first, then attempt sweep transition
      await real({ paymentId: pid, nextStatus: 'CONFIRMED' });
      return real(input); // this throws PaymentStateError
    });

    const result = await service.sweep();
    expect(result.candidates).toBe(1);
    expect(result.expired).toBe(0);
    expect(result.alreadyResolved).toBe(1);
    expect(result.outcomes[0]!.alreadyResolved).toBe(true);

    const final = await repo.getByTxRef('TX_raced');
    expect(final!.status).toBe('CONFIRMED'); // webhook won

    spy.mockRestore();
  });

  it('does NOT send notification when alreadyResolved (webhook handles it)', async () => {
    const { service, repo, setNow, notifications } = makeRig({ ttlMs: 15 * 60 * 1000 });
    setNow(0);
    const pid = await seedPayment(repo, 'TX_raced');
    setNow(20 * 60 * 1000);

    const real = repo.transitionStatus.bind(repo);
    vi.spyOn(repo, 'transitionStatus').mockImplementationOnce(async (input) => {
      await real({ paymentId: pid, nextStatus: 'FAILED', failureReason: 'card declined' });
      return real(input);
    });

    await service.sweep();
    expect(notifications.events).toHaveLength(0);
  });
});

// ─── Failure isolation ────────────────────────────────────────────────────

describe('PaymentExpiryService — failure isolation', () => {
  it('one row error does not block others', async () => {
    const { service, repo, setNow } = makeRig({ ttlMs: 15 * 60 * 1000 });
    setNow(0);
    await seedPayment(repo, 'TX_a');
    await seedPayment(repo, 'TX_b');
    await seedPayment(repo, 'TX_c');
    setNow(20 * 60 * 1000);

    // Make the SECOND transition throw an unexpected error
    const real = repo.transitionStatus.bind(repo);
    let callCount = 0;
    vi.spyOn(repo, 'transitionStatus').mockImplementation(async (input) => {
      callCount++;
      if (callCount === 2) throw new Error('transient db blip');
      return real(input);
    });

    const result = await service.sweep();
    expect(result.candidates).toBe(3);
    expect(result.expired).toBe(2);
    expect(result.errored).toBe(1);
    expect(result.outcomes.find((o) => o.error)).toBeDefined();
  });

  it('returns zero-everything if listStalePending throws', async () => {
    const { service, repo } = makeRig();
    vi.spyOn(repo, 'listStalePending').mockRejectedValueOnce(new Error('db down'));
    const result = await service.sweep();
    expect(result.candidates).toBe(0);
    expect(result.errored).toBe(0);
  });

  it('still expires row even when notification fails', async () => {
    const { service, repo, setNow, notifications } = makeRig({ ttlMs: 15 * 60 * 1000 });
    setNow(0);
    await seedPayment(repo, 'TX_a');
    setNow(20 * 60 * 1000);
    notifications.shouldFail = true;

    const result = await service.sweep();
    expect(result.expired).toBe(1);
    expect(result.notificationsSent).toBe(0);
    expect(result.outcomes[0]!.notified).toBe(false);

    const row = await repo.getByTxRef('TX_a');
    expect(row!.status).toBe('EXPIRED');
  });
});

// ─── notifyOnExpiry flag ──────────────────────────────────────────────────

describe('PaymentExpiryService — notifyOnExpiry flag', () => {
  it('skips notifications when notifyOnExpiry=false', async () => {
    const { service, repo, setNow, notifications } = makeRig({
      ttlMs: 15 * 60 * 1000,
      notifyOnExpiry: false,
    });
    setNow(0);
    await seedPayment(repo, 'TX_a');
    setNow(20 * 60 * 1000);
    const result = await service.sweep();
    expect(result.expired).toBe(1);
    expect(notifications.events).toHaveLength(0);
    expect(result.notificationsSent).toBe(0);
  });
});

// ─── Default TTL ──────────────────────────────────────────────────────────

describe('PaymentExpiryService — default TTL is 15 minutes', () => {
  it('uses 15min when not configured', async () => {
    const { service, repo, setNow } = makeRig();
    setNow(0);
    await seedPayment(repo, 'TX_just_under');
    await seedPayment(repo, 'TX_well_over');

    // After 14 min: nothing stale
    setNow(14 * 60 * 1000);
    let r = await service.sweep();
    expect(r.expired).toBe(0);

    // After 16 min: both rows are 16 min old (created at t=0)
    setNow(16 * 60 * 1000);
    r = await service.sweep();
    expect(r.expired).toBe(2);
  });
});
