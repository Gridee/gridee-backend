import { describe, expect, it } from 'vitest';
import { Phone } from '../../src/lib/phone';
import type { IMessageSender, MessageReceipt, OutboundMessage } from '../../src/messaging';
import { NotificationService } from '../../src/notifications/NotificationService';
import type { ISmsProvider, SmsReceipt } from '../../src/notifications/ISmsProvider';

const PHONE: Phone = Phone.of('+2348031234567');
const LANDLORD: Phone = Phone.of('+2348031111111');

class FakeWhatsApp implements IMessageSender {
  readonly name = 'fake-wa';
  readonly sent: OutboundMessage[] = [];
  shouldFail = false;
  async sendMessage(input: OutboundMessage): Promise<MessageReceipt> {
    if (this.shouldFail) throw new Error('whatsapp blew up');
    this.sent.push(input);
    return { to: input.to, providerMessageId: `wa_${this.sent.length}`, provider: this.name, sentAt: 1 };
  }
}

class FakeSms implements ISmsProvider {
  readonly name = 'fake-sms';
  readonly sent: { to: Phone; text: string }[] = [];
  shouldFail = false;
  async sendSms(input: { to: Phone; text: string }): Promise<SmsReceipt> {
    if (this.shouldFail) throw new Error('sms blew up');
    this.sent.push(input);
    return { to: input.to, providerMessageId: `sms_${this.sent.length}`, provider: this.name, sentAt: 1 };
  }
}

describe('NotificationService — happy path', () => {
  it('uses WhatsApp by default and reports delivered', async () => {
    const wa = new FakeWhatsApp();
    const sms = new FakeSms();
    const svc = new NotificationService({ whatsapp: wa, sms });

    const r = await svc.sendCutoffNotice(PHONE);
    expect(r.delivered).toBe(true);
    expect(r.channelUsed).toBe('whatsapp');
    expect(wa.sent).toHaveLength(1);
    expect(sms.sent).toHaveLength(0);
  });
});

describe('NotificationService — WhatsApp → SMS fallback', () => {
  it('falls back to SMS when WhatsApp fails', async () => {
    const wa = new FakeWhatsApp();
    const sms = new FakeSms();
    wa.shouldFail = true;
    const svc = new NotificationService({ whatsapp: wa, sms });

    const r = await svc.sendCutoffNotice(PHONE);
    expect(r.delivered).toBe(true);
    expect(r.channelUsed).toBe('sms');
    expect(wa.sent).toHaveLength(0);
    expect(sms.sent).toHaveLength(1);
  });

  it('reports failure when both channels fail', async () => {
    const wa = new FakeWhatsApp();
    const sms = new FakeSms();
    wa.shouldFail = true;
    sms.shouldFail = true;
    const svc = new NotificationService({ whatsapp: wa, sms });

    const r = await svc.sendCutoffNotice(PHONE);
    expect(r.delivered).toBe(false);
    expect(r.channelUsed).toBeNull();
    expect(r.error).toMatch(/whatsapp/);
    expect(r.error).toMatch(/sms/);
  });

  it('reports failure when SMS is not configured and WhatsApp fails', async () => {
    const wa = new FakeWhatsApp();
    wa.shouldFail = true;
    const svc = new NotificationService({ whatsapp: wa });

    const r = await svc.sendCutoffNotice(PHONE);
    expect(r.delivered).toBe(false);
    expect(r.channelUsed).toBeNull();
  });
});

describe('NotificationService — message content', () => {
  it('formats low-balance alert with balance', async () => {
    const wa = new FakeWhatsApp();
    const svc = new NotificationService({ whatsapp: wa });
    await svc.sendLowBalanceAlert(PHONE, 0.5);
    expect(wa.sent[0]!.text).toContain('0.50 GRD');
    expect(wa.sent[0]!.screenId).toBe('ALERT_LOW_BALANCE');
  });

  it('formats purchase confirmed with amount and new balance', async () => {
    const wa = new FakeWhatsApp();
    const svc = new NotificationService({ whatsapp: wa });
    await svc.sendPurchaseConfirmed(PHONE, 4.0, 5.0);
    expect(wa.sent[0]!.text).toContain('+4.00 GRD');
    expect(wa.sent[0]!.text).toContain('5.00 GRD');
  });

  it('formats withdrawal-confirmed with NGN amount', async () => {
    const wa = new FakeWhatsApp();
    const svc = new NotificationService({ whatsapp: wa });
    await svc.sendWithdrawalConfirmed(LANDLORD, 50_000);
    expect(wa.sent[0]!.text).toContain('₦50,000');
  });

  it('every method tags the right screenId', async () => {
    const wa = new FakeWhatsApp();
    const svc = new NotificationService({ whatsapp: wa });

    await svc.sendLowBalanceAlert(PHONE, 0.5);
    await svc.sendCutoffNotice(PHONE);
    await svc.sendRestoredNotice(PHONE, 5.0);
    await svc.sendPurchaseConfirmed(PHONE, 4.0, 5.0);
    await svc.sendPaymentFailed(PHONE, 'card declined');
    await svc.sendNewTenantAlert(LANDLORD, 'Musa', 'GRD-LAG-0042');
    await svc.sendWithdrawalInitiated(LANDLORD, 50_000);
    await svc.sendWithdrawalConfirmed(LANDLORD, 50_000);

    const expected = [
      'ALERT_LOW_BALANCE',
      'ALERT_CUTOFF',
      'ALERT_RESTORED',
      'NOTIFY_PURCHASE_CONFIRMED',
      'PAYMENT_FAILED',
      'NOTIFY_NEW_TENANT',
      'WITHDRAWAL_INITIATED',
      'NOTIFY_WITHDRAWAL_CONFIRMED',
    ];
    expect(wa.sent.map((m) => m.screenId)).toEqual(expected);
  });
});

describe('NotificationService — tenant removal dual dispatch', () => {
  it('sends to both landlord and tenant in parallel', async () => {
    const wa = new FakeWhatsApp();
    const svc = new NotificationService({ whatsapp: wa });

    const r = await svc.sendTenantRemoved({
      landlordPhone: LANDLORD,
      tenantPhone: PHONE,
      tenantName: 'Musa',
      propertyLabel: 'Surulere Block A',
    });

    expect(r.landlord.delivered).toBe(true);
    expect(r.tenant.delivered).toBe(true);
    expect(wa.sent).toHaveLength(2);
    expect(wa.sent.map((m) => m.screenId)).toEqual(
      expect.arrayContaining(['TENANT_REMOVED_LANDLORD', 'TENANT_REMOVED_EVICTED']),
    );
  });

  it('one failure does not block the other', async () => {
    const wa = new FakeWhatsApp();
    let count = 0;
    wa.sendMessage = async (input: OutboundMessage): Promise<MessageReceipt> => {
      count++;
      // Fail the landlord send (first call), succeed the tenant
      if (count === 1) throw new Error('landlord delivery failed');
      wa.sent.push(input);
      return { to: input.to, providerMessageId: 'm', provider: 'fake-wa', sentAt: 1 };
    };

    const svc = new NotificationService({ whatsapp: wa });
    const r = await svc.sendTenantRemoved({
      landlordPhone: LANDLORD,
      tenantPhone: PHONE,
      tenantName: 'Musa',
      propertyLabel: 'Surulere Block A',
    });

    // Both calls happen; one fails. Without SMS fallback, landlord is undelivered.
    expect(r.landlord.delivered).toBe(false);
    expect(r.tenant.delivered).toBe(true);
  });
});
