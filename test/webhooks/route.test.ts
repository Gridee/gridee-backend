import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { HardwareLayerFactory, InMemoryEnergyBalanceRepository, TenantId } from '../../src/hal';
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
  makePaymentWebhookRouter,
} from '../../src/webhooks';

const SECRET = 'test-secret-hash';
const TENANT = TenantId.of('t1');
const PHONE = Phone.of('+2348031234567');

class StubNotifications implements INotificationService {
  private ok(): NotificationResult { return { delivered: true, channelUsed: 'whatsapp' }; }
  async sendLowBalanceAlert(): Promise<NotificationResult> { return this.ok(); }
  async sendCutoffNotice(): Promise<NotificationResult> { return this.ok(); }
  async sendRestoredNotice(): Promise<NotificationResult> { return this.ok(); }
  async sendPurchaseConfirmed(): Promise<NotificationResult> { return this.ok(); }
  async sendPaymentFailed(): Promise<NotificationResult> { return this.ok(); }
  async sendNewTenantAlert(): Promise<NotificationResult> { return this.ok(); }
  async sendWithdrawalInitiated(): Promise<NotificationResult> { return this.ok(); }
  async sendWithdrawalConfirmed(): Promise<NotificationResult> { return this.ok(); }
  async sendTenantRemoved(): Promise<{ landlord: NotificationResult; tenant: NotificationResult }> {
    return { landlord: this.ok(), tenant: this.ok() };
  }
}

interface Rig {
  app: express.Express;
  paymentRepo: IPaymentRepository;
  energyRepo: InMemoryEnergyBalanceRepository;
}

function makeApp(): Rig {
  const energyRepo = new InMemoryEnergyBalanceRepository();
  const hal = HardwareLayerFactory.create({ type: 'mock', repository: energyRepo });
  const reconnectService = new ReconnectService({ hal, notifications: new StubNotifications() });
  const paymentRepo = new InMemoryPaymentRepository();
  const handler = new PaymentWebhookHandler({
    provider: new FlutterwavePaymentProvider({ secretHash: SECRET }),
    idempotencyStore: new InMemoryWebhookIdempotencyStore(),
    paymentRepo,
    reconnectService,
    notifications: new StubNotifications(),
  });
  const app = express();
  app.use(makePaymentWebhookRouter({ handler }));
  return { app, paymentRepo, energyRepo };
}

async function seedPending(repo: IPaymentRepository, txRef: string): Promise<void> {
  await repo.create({
    paymentId: PaymentId.of(`pay_${txRef}`),
    tenantId: TENANT,
    tenantPhone: PHONE,
    txRef,
    expectedAmountNgn: 5000,
    expectedMGrd: 4000,
    method: 'BANK_TRANSFER',
    provider: 'flutterwave',
  });
}

const PAYLOAD = (txRef: string, eventId: string, status = 'successful'): string =>
  JSON.stringify({
    event: 'charge.completed',
    data: {
      id: eventId,
      tx_ref: txRef,
      amount: 5000,
      currency: 'NGN',
      status,
    },
  });

describe('makePaymentWebhookRouter — HTTP integration', () => {
  it('200 + processed for valid signed webhook', async () => {
    const { app, paymentRepo, energyRepo } = makeApp();
    await seedPending(paymentRepo, 'TX_1');

    const res = await request(app)
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .set('verif-hash', SECRET)
      .send(PAYLOAD('TX_1', 'evt_1'))
      .expect(200);

    expect(res.body).toEqual({ received: true, kind: 'processed' });

    const row = await paymentRepo.getByTxRef('TX_1');
    expect(row!.status).toBe('CONFIRMED');
    const energyRow = await energyRepo.get(TENANT);
    expect(energyRow!.balanceMGrd).toBe(4000);
  });

  it('401 when signature is missing', async () => {
    const { app } = makeApp();
    await request(app)
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .send(PAYLOAD('TX_1', 'evt_1'))
      .expect(401);
  });

  it('401 when signature is wrong', async () => {
    const { app } = makeApp();
    await request(app)
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .set('verif-hash', 'wrong-secret-value-999')
      .send(PAYLOAD('TX_1', 'evt_1'))
      .expect(401);
  });

  it('200 + duplicate on second delivery', async () => {
    const { app, paymentRepo } = makeApp();
    await seedPending(paymentRepo, 'TX_1');
    const send = (): request.Test =>
      request(app)
        .post('/webhooks/flutterwave')
        .set('Content-Type', 'application/json')
        .set('verif-hash', SECRET)
        .send(PAYLOAD('TX_1', 'evt_dup'));

    const r1 = await send().expect(200);
    expect(r1.body.kind).toBe('processed');
    const r2 = await send().expect(200);
    expect(r2.body.kind).toBe('duplicate');
  });

  it('200 + unknown_payment when txRef not seeded', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .set('verif-hash', SECRET)
      .send(PAYLOAD('TX_GHOST', 'evt_1'))
      .expect(200);
    expect(res.body.kind).toBe('unknown_payment');
  });

  it('200 + parse_error on bad JSON', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .set('verif-hash', SECRET)
      .send('not-json')
      .expect(200);
    expect(res.body.kind).toBe('parse_error');
  });

  it('200 + irrelevant on non-charge events', async () => {
    const { app } = makeApp();
    const payload = JSON.stringify({
      event: 'transfer.completed',
      data: { id: 1, tx_ref: 'TX_1', amount: 5000, currency: 'NGN', status: 'successful' },
    });
    const res = await request(app)
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .set('verif-hash', SECRET)
      .send(payload)
      .expect(200);
    expect(res.body.kind).toBe('irrelevant');
  });

  it('200 + amount_mismatch when FW reports different amount', async () => {
    const { app, paymentRepo } = makeApp();
    await seedPending(paymentRepo, 'TX_1');
    const tampered = JSON.stringify({
      event: 'charge.completed',
      data: { id: 'evt_1', tx_ref: 'TX_1', amount: 100, currency: 'NGN', status: 'successful' },
    });
    const res = await request(app)
      .post('/webhooks/flutterwave')
      .set('Content-Type', 'application/json')
      .set('verif-hash', SECRET)
      .send(tampered)
      .expect(200);
    expect(res.body.kind).toBe('amount_mismatch');
    const row = await paymentRepo.getByTxRef('TX_1');
    expect(row!.status).toBe('FAILED');
  });
});
