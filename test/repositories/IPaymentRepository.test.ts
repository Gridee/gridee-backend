import { describe, expect, it } from 'vitest';
import { TenantId } from '../../src/hal';
import { Phone } from '../../src/lib/phone';
import {
  InMemoryPaymentRepository,
  PaymentId,
  PaymentNotFoundError,
  PaymentRepoError,
  PaymentStateError,
} from '../../src/repositories';

const TENANT = TenantId.of('t1');
const PHONE = Phone.of('+2348031234567');

function makeRepo(): InMemoryPaymentRepository {
  return new InMemoryPaymentRepository({ clock: () => 1_700_000_000_000 });
}

function seed(repo: InMemoryPaymentRepository, paymentId: PaymentId, txRef: string): void {
  void repo.create({
    paymentId,
    tenantId: TENANT,
    tenantPhone: PHONE,
    txRef,
    expectedAmountNgn: 5000,
    expectedMGrd: 4000,
    method: 'BANK_TRANSFER',
    provider: 'flutterwave',
  });
}

describe('InMemoryPaymentRepository — create + get', () => {
  it('creates a PENDING row and is fetchable by id and txRef', async () => {
    const repo = makeRepo();
    const pid = PaymentId.of('pay_1');
    const created = await repo.create({
      paymentId: pid,
      tenantId: TENANT,
      tenantPhone: PHONE,
      txRef: 'TX_abc',
      expectedAmountNgn: 5000,
      expectedMGrd: 4000,
      method: 'BANK_TRANSFER',
      provider: 'flutterwave',
    });
    expect(created.status).toBe('PENDING');
    expect(created.failureReason).toBeNull();
    expect(created.resolvedAt).toBeNull();

    const byId = await repo.getById(pid);
    expect(byId).toEqual(created);
    const byRef = await repo.getByTxRef('TX_abc');
    expect(byRef).toEqual(created);
  });

  it('returns null for missing payment', async () => {
    const repo = makeRepo();
    expect(await repo.getById(PaymentId.of('nope'))).toBeNull();
    expect(await repo.getByTxRef('nope')).toBeNull();
  });

  it('rejects duplicate paymentId', async () => {
    const repo = makeRepo();
    seed(repo, PaymentId.of('pay_1'), 'TX_a');
    await expect(
      repo.create({
        paymentId: PaymentId.of('pay_1'),
        tenantId: TENANT,
        tenantPhone: PHONE,
        txRef: 'TX_b',
        expectedAmountNgn: 5000,
        expectedMGrd: 4000,
        method: 'BANK_TRANSFER',
        provider: 'flutterwave',
      }),
    ).rejects.toThrow(PaymentRepoError);
  });

  it('rejects duplicate txRef', async () => {
    const repo = makeRepo();
    seed(repo, PaymentId.of('pay_1'), 'TX_a');
    await expect(
      repo.create({
        paymentId: PaymentId.of('pay_2'),
        tenantId: TENANT,
        tenantPhone: PHONE,
        txRef: 'TX_a',
        expectedAmountNgn: 5000,
        expectedMGrd: 4000,
        method: 'BANK_TRANSFER',
        provider: 'flutterwave',
      }),
    ).rejects.toThrow(PaymentRepoError);
  });
});

describe('InMemoryPaymentRepository — transitionStatus', () => {
  it('PENDING → CONFIRMED', async () => {
    const repo = makeRepo();
    const pid = PaymentId.of('p1');
    seed(repo, pid, 'TX_1');
    const next = await repo.transitionStatus({ paymentId: pid, nextStatus: 'CONFIRMED' });
    expect(next.status).toBe('CONFIRMED');
    expect(next.resolvedAt).not.toBeNull();
    expect(next.failureReason).toBeNull();
  });

  it('PENDING → FAILED with reason', async () => {
    const repo = makeRepo();
    const pid = PaymentId.of('p1');
    seed(repo, pid, 'TX_1');
    const next = await repo.transitionStatus({
      paymentId: pid,
      nextStatus: 'FAILED',
      failureReason: 'card declined',
    });
    expect(next.status).toBe('FAILED');
    expect(next.failureReason).toBe('card declined');
  });

  it('PENDING → EXPIRED', async () => {
    const repo = makeRepo();
    const pid = PaymentId.of('p1');
    seed(repo, pid, 'TX_1');
    const next = await repo.transitionStatus({ paymentId: pid, nextStatus: 'EXPIRED' });
    expect(next.status).toBe('EXPIRED');
    expect(next.failureReason).toBeNull();
  });

  it('rejects transition from CONFIRMED to anything (terminal)', async () => {
    const repo = makeRepo();
    const pid = PaymentId.of('p1');
    seed(repo, pid, 'TX_1');
    await repo.transitionStatus({ paymentId: pid, nextStatus: 'CONFIRMED' });
    await expect(
      repo.transitionStatus({ paymentId: pid, nextStatus: 'CONFIRMED' }),
    ).rejects.toThrow(PaymentStateError);
    await expect(
      repo.transitionStatus({ paymentId: pid, nextStatus: 'FAILED', failureReason: 'x' }),
    ).rejects.toThrow(PaymentStateError);
  });

  it('rejects transition from FAILED', async () => {
    const repo = makeRepo();
    const pid = PaymentId.of('p1');
    seed(repo, pid, 'TX_1');
    await repo.transitionStatus({ paymentId: pid, nextStatus: 'FAILED', failureReason: 'x' });
    await expect(
      repo.transitionStatus({ paymentId: pid, nextStatus: 'CONFIRMED' }),
    ).rejects.toThrow(PaymentStateError);
  });

  it('throws PaymentNotFoundError for missing id', async () => {
    const repo = makeRepo();
    await expect(
      repo.transitionStatus({ paymentId: PaymentId.of('nope'), nextStatus: 'CONFIRMED' }),
    ).rejects.toThrow(PaymentNotFoundError);
  });
});
