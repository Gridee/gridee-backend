import { describe, expect, it, vi } from 'vitest';
import {
  HardwareLayerFactory,
  InMemoryEnergyBalanceRepository,
  TenantId,
} from '../../src/hal';
import { Phone } from '../../src/lib/phone';
import type { INotificationService, NotificationResult } from '../../src/notifications';
import {
  InMemoryPaymentRepository,
  PaymentId,
  type IPaymentRepository,
} from '../../src/repositories';
import { ReconnectService } from '../../src/services';
import {
  FlutterwavePaymentProvider,
  InMemoryWebhookIdempotencyStore,
  PaymentWebhookHandler,
  type WebhookOutcome,
} from '../../src/webhooks';

const SECRET = 'test-secret-hash';
const TENANT = TenantId.of('t1');
const PHONE = Phone.of('+2348031234567');

class FakeNotifications implements INotificationService {
  readonly events: { method: string; phone: Phone; arg?: unknown }[] = [];
  private ok(): NotificationResult { return { delivered: true, channelUsed: 'whatsapp' }; }
  async sendLowBalanceAlert(): Promise<NotificationResult> { return this.ok(); }
  async sendCutoffNotice(): Promise<NotificationResult> { return this.ok(); }
  async sendRestoredNotice(phone: Phone): Promise<NotificationResult> {
    this.events.push({ method: 'sendRestoredNotice', phone });
    return this.ok();
  }
  async sendPurchaseConfirmed(phone: Phone): Promise<NotificationResult> {
    this.events.push({ method: 'sendPurchaseConfirmed', phone });
    return this.ok();
  }
  async sendPaymentFailed(phone: Phone, reason: string): Promise<NotificationResult> {
    this.events.push({ method: 'sendPaymentFailed', phone, arg: reason });
    return this.ok();
  }
  async sendNewTenantAlert(): Promise<NotificationResult> { return this.ok(); }
  async sendWithdrawalInitiated(): Promise<NotificationResult> { return this.ok(); }
  async sendWithdrawalConfirmed(): Promise<NotificationResult> { return this.ok(); }
  async sendTenantRemoved(): Promise<{ landlord: NotificationResult; tenant: NotificationResult }> {
    return { landlord: this.ok(), tenant: this.ok() };
  }
}

interface Rig {
  handler: PaymentWebhookHandler;
  paymentRepo: IPaymentRepository;
  energyRepo: InMemoryEnergyBalanceRepository;
  idempotency: InMemoryWebhookIdempotencyStore;
  notifications: FakeNotifications;
  hal: ReturnType<typeof HardwareLayerFactory.create>;
}

function makeRig(): Rig {
  const energyRepo = new InMemoryEnergyBalanceRepository();
  const hal = HardwareLayerFactory.create({ type: 'mock', repository: energyRepo });
  const notifications = new FakeNotifications();
  const reconnectService = new ReconnectService({ hal, notifications });
  const paymentRepo = new InMemoryPaymentRepository();
  const idempotency = new InMemoryWebhookIdempotencyStore();
  const provider = new FlutterwavePaymentProvider({ secretHash: SECRET });

  const handler = new PaymentWebhookHandler({
    provider,
    idempotencyStore: idempotency,
    paymentRepo,
    reconnectService,
    notifications,
  });

  return { handler, paymentRepo, energyRepo, idempotency, notifications, hal };
}

async function seedPendingPayment(
  repo: IPaymentRepository,
  txRef: string,
  amountNgn = 5000,
  expectedMGrd = 4000,
): Promise<PaymentId> {
  const pid = PaymentId.of(`pay_${txRef}`);
  await repo.create({
    paymentId: pid,
    tenantId: TENANT,
    tenantPhone: PHONE,
    txRef,
    expectedAmountNgn: amountNgn,
    expectedMGrd,
    method: 'BANK_TRANSFER',
    provider: 'flutterwave',
  });
  return pid;
}

function buildBody(input: {
  eventId: string | number;
  txRef: string;
  amount: number;
  currency?: string;
  status: 'successful' | 'failed' | 'pending';
  failureReason?: string;
  event?: string;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: input.event ?? 'charge.completed',
      data: {
        id: input.eventId,
        tx_ref: input.txRef,
        amount: input.amount,
        currency: input.currency ?? 'NGN',
        status: input.status,
        ...(input.failureReason ? { failure_reason: input.failureReason } : {}),
      },
    }),
  );
}

// ─── Signature verification ────────────────────────────────────────────────

describe('PaymentWebhookHandler — signature', () => {
  it('returns signature_invalid when header is missing', async () => {
    const { handler } = makeRig();
    const body = buildBody({ eventId: 1, txRef: 'TX_1', amount: 5000, status: 'successful' });
    const r = await handler.handle(body, undefined);
    expect(r.kind).toBe('signature_invalid');
    expect(PaymentWebhookHandler.httpStatusFor(r)).toBe(401);
  });

  it('returns signature_invalid when header is wrong', async () => {
    const { handler } = makeRig();
    const body = buildBody({ eventId: 1, txRef: 'TX_1', amount: 5000, status: 'successful' });
    const r = await handler.handle(body, 'wrong-secret');
    expect(r.kind).toBe('signature_invalid');
  });
});

// ─── Parse outcomes ────────────────────────────────────────────────────────

describe('PaymentWebhookHandler — parsing', () => {
  it('returns parse_error on invalid JSON', async () => {
    const { handler } = makeRig();
    const r = await handler.handle(Buffer.from('not-json'), SECRET);
    expect(r.kind).toBe('parse_error');
    expect(PaymentWebhookHandler.httpStatusFor(r)).toBe(200); // FW won't retry
  });

  it('returns irrelevant on non-charge events', async () => {
    const { handler } = makeRig();
    const body = buildBody({
      eventId: 1,
      txRef: 'TX_1',
      amount: 5000,
      status: 'successful',
      event: 'transfer.completed',
    });
    const r = await handler.handle(body, SECRET);
    expect(r.kind).toBe('irrelevant');
    expect(PaymentWebhookHandler.httpStatusFor(r)).toBe(200);
  });

  it('returns irrelevant on pending status', async () => {
    const { handler } = makeRig();
    const body = buildBody({ eventId: 1, txRef: 'TX_1', amount: 5000, status: 'pending' });
    const r = await handler.handle(body, SECRET);
    expect(r.kind).toBe('irrelevant');
  });
});

// ─── Idempotency ───────────────────────────────────────────────────────────

describe('PaymentWebhookHandler — idempotency', () => {
  it('processes first delivery, skips second with same eventId', async () => {
    const { handler, paymentRepo, notifications } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1');
    const body = buildBody({ eventId: 'evt_1', txRef: 'TX_1', amount: 5000, status: 'successful' });

    const r1 = await handler.handle(body, SECRET);
    expect(r1.kind).toBe('processed');

    const r2 = await handler.handle(body, SECRET);
    expect(r2.kind).toBe('duplicate');

    // Side effects fire only once
    expect(notifications.events.filter((e) => e.method === 'sendPurchaseConfirmed')).toHaveLength(1);
  });

  it('different eventIds for same txRef are processed (but state machine guards)', async () => {
    const { handler, paymentRepo } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1');
    const r1 = await handler.handle(
      buildBody({ eventId: 'evt_a', txRef: 'TX_1', amount: 5000, status: 'successful' }),
      SECRET,
    );
    const r2 = await handler.handle(
      buildBody({ eventId: 'evt_b', txRef: 'TX_1', amount: 5000, status: 'successful' }),
      SECRET,
    );
    expect(r1.kind).toBe('processed');
    // Second event got past idempotency (different eventId), but the payment
    // is already CONFIRMED → already_terminal
    expect(r2.kind).toBe('already_terminal');
    if (r2.kind === 'already_terminal') {
      // The handler reports the payment's current status when it tried to
      // transition. After r1 confirmed it, r2 sees status=CONFIRMED.
      expect(r2.status).toBe('CONFIRMED');
    }
  });

  it('processes anyway if idempotency store throws', async () => {
    const { handler, paymentRepo, idempotency } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1');
    vi.spyOn(idempotency, 'markProcessed').mockRejectedValueOnce(new Error('redis blip'));
    const r = await handler.handle(
      buildBody({ eventId: 'evt_1', txRef: 'TX_1', amount: 5000, status: 'successful' }),
      SECRET,
    );
    expect(r.kind).toBe('processed');
  });
});

// ─── Unknown payment ───────────────────────────────────────────────────────

describe('PaymentWebhookHandler — unknown payment', () => {
  it('returns unknown_payment when txRef has no record', async () => {
    const { handler } = makeRig();
    const body = buildBody({ eventId: 'evt_1', txRef: 'TX_GHOST', amount: 5000, status: 'successful' });
    const r = await handler.handle(body, SECRET);
    expect(r.kind).toBe('unknown_payment');
    expect(PaymentWebhookHandler.httpStatusFor(r)).toBe(200);
  });
});

// ─── Amount + currency validation ─────────────────────────────────────────

describe('PaymentWebhookHandler — validation', () => {
  it('marks FAILED on amount mismatch', async () => {
    const { handler, paymentRepo, energyRepo, notifications } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1', 5000, 4000);
    // FW says 100 instead of 5000
    const body = buildBody({ eventId: 'evt_1', txRef: 'TX_1', amount: 100, status: 'successful' });
    const r = await handler.handle(body, SECRET);

    expect(r.kind).toBe('amount_mismatch');
    if (r.kind === 'amount_mismatch') {
      expect(r.expected).toBe(5000);
      expect(r.got).toBe(100);
    }

    // Payment row should be FAILED
    const paymentAfter = await paymentRepo.getByTxRef('TX_1');
    expect(paymentAfter!.status).toBe('FAILED');
    expect(paymentAfter!.failureReason).toMatch(/amount_mismatch/);

    // No mint should have happened
    const energyRow = await energyRepo.get(TENANT);
    expect(energyRow).toBeNull();

    // No purchase notification (should not credit)
    expect(notifications.events.find((e) => e.method === 'sendPurchaseConfirmed')).toBeUndefined();
  });

  it('marks FAILED on currency mismatch (USD instead of NGN)', async () => {
    const { handler, paymentRepo } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1');
    const body = buildBody({
      eventId: 'evt_1',
      txRef: 'TX_1',
      amount: 5000,
      currency: 'USD',
      status: 'successful',
    });
    const r = await handler.handle(body, SECRET);
    expect(r.kind).toBe('currency_unsupported');
    const paymentAfter = await paymentRepo.getByTxRef('TX_1');
    expect(paymentAfter!.status).toBe('FAILED');
  });
});

// ─── Successful flow — full lifecycle ──────────────────────────────────────

describe('PaymentWebhookHandler — successful flow', () => {
  it('marks CONFIRMED, mints, reconnects, sends both notifications (first top-up)', async () => {
    const { handler, paymentRepo, notifications, hal } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1', 5000, 4000);

    const body = buildBody({ eventId: 'evt_1', txRef: 'TX_1', amount: 5000, status: 'successful' });
    const r = await handler.handle(body, SECRET);

    expect(r.kind).toBe('processed');
    if (r.kind === 'processed') {
      expect(r.outcome).toBe('completed');
    }

    // Payment row → CONFIRMED
    const paymentAfter = await paymentRepo.getByTxRef('TX_1');
    expect(paymentAfter!.status).toBe('CONFIRMED');
    expect(paymentAfter!.resolvedAt).not.toBeNull();

    // Energy balance: minted to 4000 mGRD, state CONNECTED
    const status = await hal.getMeterStatus(TENANT);
    expect(status.balanceMGrd).toBe(4000);
    expect(status.state).toBe('CONNECTED');

    // Both notifications fired (first top-up: wasDepleted=true)
    const eventNames = notifications.events.map((e) => e.method);
    expect(eventNames).toEqual(['sendPurchaseConfirmed', 'sendRestoredNotice']);
  });

  it('only sends purchase confirmed (no reconnect) when balance was non-zero', async () => {
    const { handler, paymentRepo, energyRepo, notifications, hal } = makeRig();
    energyRepo._seedForTest({
      tenantId: TENANT,
      balanceMGrd: 1000,
      state: 'CONNECTED',
      lastUpdatedAt: 0,
    });
    await seedPendingPayment(paymentRepo, 'TX_1', 5000, 4000);

    await handler.handle(
      buildBody({ eventId: 'evt_1', txRef: 'TX_1', amount: 5000, status: 'successful' }),
      SECRET,
    );

    const status = await hal.getMeterStatus(TENANT);
    expect(status.balanceMGrd).toBe(5000);
    expect(status.state).toBe('CONNECTED');

    expect(notifications.events.map((e) => e.method)).toEqual(['sendPurchaseConfirmed']);
  });
});

// ─── Failed flow ───────────────────────────────────────────────────────────

describe('PaymentWebhookHandler — failed flow', () => {
  it('marks FAILED, sends payment-failed notification, does NOT mint', async () => {
    const { handler, paymentRepo, energyRepo, notifications } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1');

    const body = buildBody({
      eventId: 'evt_1',
      txRef: 'TX_1',
      amount: 5000,
      status: 'failed',
      failureReason: 'card declined',
    });
    const r = await handler.handle(body, SECRET);
    expect(r.kind).toBe('processed');
    if (r.kind === 'processed') expect(r.outcome).toBe('failed');

    const paymentAfter = await paymentRepo.getByTxRef('TX_1');
    expect(paymentAfter!.status).toBe('FAILED');
    expect(paymentAfter!.failureReason).toBe('card declined');

    expect(notifications.events.find((e) => e.method === 'sendPaymentFailed')).toBeDefined();

    // No mint
    expect(await energyRepo.get(TENANT)).toBeNull();
  });
});

// ─── State machine guards ─────────────────────────────────────────────────

describe('PaymentWebhookHandler — state guards', () => {
  it('returns already_terminal for second confirmation (different eventId)', async () => {
    const { handler, paymentRepo } = makeRig();
    await seedPendingPayment(paymentRepo, 'TX_1');
    await handler.handle(
      buildBody({ eventId: 'evt_a', txRef: 'TX_1', amount: 5000, status: 'successful' }),
      SECRET,
    );
    // Second webhook with a fresh eventId — bypasses idempotency, but state machine catches it
    const r2 = await handler.handle(
      buildBody({ eventId: 'evt_b', txRef: 'TX_1', amount: 5000, status: 'successful' }),
      SECRET,
    );
    expect(r2.kind).toBe('already_terminal');
  });
});

// ─── HTTP status mapping ──────────────────────────────────────────────────

describe('PaymentWebhookHandler.httpStatusFor', () => {
  const cases: { outcome: WebhookOutcome; expected: number }[] = [
    { outcome: { kind: 'signature_invalid' }, expected: 401 },
    { outcome: { kind: 'mint_failed', txRef: 'TX_1', error: 'x' }, expected: 500 },
    { outcome: { kind: 'processed', eventId: 'e', txRef: 'T', outcome: 'completed' }, expected: 200 },
    { outcome: { kind: 'duplicate', eventId: 'e' }, expected: 200 },
    { outcome: { kind: 'irrelevant' }, expected: 200 },
    { outcome: { kind: 'parse_error', error: 'x' }, expected: 200 },
    { outcome: { kind: 'unknown_payment', txRef: 'T' }, expected: 200 },
    { outcome: { kind: 'amount_mismatch', txRef: 'T', expected: 1, got: 2 }, expected: 200 },
    { outcome: { kind: 'currency_unsupported', txRef: 'T', currency: 'X' }, expected: 200 },
    { outcome: { kind: 'already_terminal', txRef: 'T', status: 'CONFIRMED' }, expected: 200 },
  ];
  it.each(cases)('$outcome.kind → $expected', ({ outcome, expected }) => {
    expect(PaymentWebhookHandler.httpStatusFor(outcome)).toBe(expected);
  });
});

// ─── Mint failure path ────────────────────────────────────────────────────

describe('PaymentWebhookHandler — mint failure', () => {
  it('returns mint_failed when ReconnectService throws (so caller can 5xx for retry)', async () => {
    // Build a custom rig where the HAL's repo will reject mint
    const { handler, paymentRepo } = makeRig();
    // Seed a payment with INVALID expectedMGrd (negative) — will trip HAL's
    // argument validation and throw
    await paymentRepo.create({
      paymentId: PaymentId.of('pay_x'),
      tenantId: TENANT,
      tenantPhone: PHONE,
      txRef: 'TX_x',
      expectedAmountNgn: 5000,
      expectedMGrd: -100, // invalid: HAL will throw
      method: 'BANK_TRANSFER',
      provider: 'flutterwave',
    });

    const r = await handler.handle(
      buildBody({ eventId: 'evt_x', txRef: 'TX_x', amount: 5000, status: 'successful' }),
      SECRET,
    );
    expect(r.kind).toBe('mint_failed');
    expect(PaymentWebhookHandler.httpStatusFor(r)).toBe(500);
  });
});
