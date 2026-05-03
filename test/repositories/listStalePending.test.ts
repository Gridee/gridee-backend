import { describe, expect, it } from 'vitest';
import { TenantId } from '../../src/hal';
import { Phone } from '../../src/lib/phone';
import { InMemoryPaymentRepository, PaymentId } from '../../src/repositories';

const TENANT = TenantId.of('t1');
const PHONE = Phone.of('+2348031234567');

function seed(repo: InMemoryPaymentRepository, txRef: string, _ageMs: number): Promise<void> {
  // Note: clock is fixed when constructing the repo; we exercise time-control
  // by creating new repos with different clocks.
  return repo.create({
    paymentId: PaymentId.of(`pay_${txRef}`),
    tenantId: TENANT,
    tenantPhone: PHONE,
    txRef,
    expectedAmountNgn: 5000,
    expectedMGrd: 4000,
    method: 'BANK_TRANSFER',
    provider: 'flutterwave',
  }).then(() => undefined);
}

describe('InMemoryPaymentRepository.listStalePending', () => {
  it('returns rows older than threshold, oldest first', async () => {
    // Build the repo with a controllable clock
    let clockNow = 1_000_000;
    const repo = new InMemoryPaymentRepository({ clock: () => clockNow });

    // Create payments at different "times"
    clockNow = 1_000;
    await seed(repo, 'TX_old1', 0);
    clockNow = 2_000;
    await seed(repo, 'TX_old2', 0);
    clockNow = 5_000;
    await seed(repo, 'TX_recent', 0);

    // List those older than t=3000 — should include TX_old1 and TX_old2 only
    const stale = await repo.listStalePending({ olderThan: 3_000 });
    expect(stale.map((r) => r.txRef)).toEqual(['TX_old1', 'TX_old2']);
  });

  it('respects the limit', async () => {
    let clockNow = 1_000;
    const repo = new InMemoryPaymentRepository({ clock: () => clockNow });
    for (let i = 0; i < 10; i++) {
      clockNow = 1_000 + i;
      await seed(repo, `TX_${i}`, 0);
    }
    const stale = await repo.listStalePending({ olderThan: 1_000_000, limit: 3 });
    expect(stale).toHaveLength(3);
    // Sorted oldest-first, so first 3 created
    expect(stale.map((r) => r.txRef)).toEqual(['TX_0', 'TX_1', 'TX_2']);
  });

  it('excludes rows in terminal states', async () => {
    let clockNow = 1_000;
    const repo = new InMemoryPaymentRepository({ clock: () => clockNow });
    await seed(repo, 'TX_pending', 0);
    await seed(repo, 'TX_confirmed', 0);
    await seed(repo, 'TX_failed', 0);
    await seed(repo, 'TX_expired', 0);

    await repo.transitionStatus({ paymentId: PaymentId.of('pay_TX_confirmed'), nextStatus: 'CONFIRMED' });
    await repo.transitionStatus({ paymentId: PaymentId.of('pay_TX_failed'), nextStatus: 'FAILED', failureReason: 'x' });
    await repo.transitionStatus({ paymentId: PaymentId.of('pay_TX_expired'), nextStatus: 'EXPIRED' });

    const stale = await repo.listStalePending({ olderThan: 1_000_000 });
    expect(stale).toHaveLength(1);
    expect(stale[0]!.txRef).toBe('TX_pending');
  });

  it('returns empty array when no stale rows', async () => {
    const repo = new InMemoryPaymentRepository({ clock: () => 5_000 });
    await seed(repo, 'TX_now', 0);
    const stale = await repo.listStalePending({ olderThan: 1_000 });
    expect(stale).toEqual([]);
  });
});
