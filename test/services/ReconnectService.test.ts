import { describe, expect, it } from 'vitest';
import { HardwareLayerFactory, InMemoryEnergyBalanceRepository, TenantId } from '../../src/hal';
import { Phone } from '../../src/lib/phone';
import type { INotificationService, NotificationResult } from '../../src/notifications';
import { ReconnectService } from '../../src/services/ReconnectService';

const TENANT_ID = TenantId.of('t1');
const PHONE = Phone.of('+2348031234567');

class FakeNotifications implements INotificationService {
  readonly events: { method: string; phone: Phone }[] = [];
  shouldFailRestored = false;
  private ok(): NotificationResult { return { delivered: true, channelUsed: 'whatsapp' }; }
  async sendLowBalanceAlert(): Promise<NotificationResult> { return this.ok(); }
  async sendCutoffNotice(): Promise<NotificationResult> { return this.ok(); }
  async sendRestoredNotice(phone: Phone): Promise<NotificationResult> {
    this.events.push({ method: 'sendRestoredNotice', phone });
    return this.shouldFailRestored
      ? { delivered: false, channelUsed: null, error: 'fake' }
      : this.ok();
  }
  async sendPurchaseConfirmed(phone: Phone): Promise<NotificationResult> {
    this.events.push({ method: 'sendPurchaseConfirmed', phone });
    return this.ok();
  }
  async sendPaymentFailed(): Promise<NotificationResult> { return this.ok(); }
  async sendNewTenantAlert(): Promise<NotificationResult> { return this.ok(); }
  async sendWithdrawalInitiated(): Promise<NotificationResult> { return this.ok(); }
  async sendWithdrawalConfirmed(): Promise<NotificationResult> { return this.ok(); }
  async sendTenantRemoved(): Promise<{ landlord: NotificationResult; tenant: NotificationResult }> {
    return { landlord: this.ok(), tenant: this.ok() };
  }
}

interface Rig {
  service: ReconnectService;
  hal: ReturnType<typeof HardwareLayerFactory.create>;
  repo: InMemoryEnergyBalanceRepository;
  notifications: FakeNotifications;
}

function makeRig(): Rig {
  const repo = new InMemoryEnergyBalanceRepository();
  const hal = HardwareLayerFactory.create({ type: 'mock', repository: repo });
  const notifications = new FakeNotifications();
  const service = new ReconnectService({ hal, notifications });
  return { service, hal, repo, notifications };
}

describe('ReconnectService — first-time top-up (wasDepleted)', () => {
  it('mints, reconnects, sends both purchase + restored notices', async () => {
    const { service, hal, notifications } = makeRig();
    // No row exists yet — first top-up
    const result = await service.handlePaymentConfirmed({
      tenantId: TENANT_ID,
      tenantPhone: PHONE,
      amountNgn: 5000,
      mGrdMinted: 4_000,
    });

    expect(result.mGrdMinted).toBe(4_000);
    expect(result.balanceAfterMGrd).toBe(4_000);
    expect(result.reconnected).toBe(true);
    expect(result.purchaseNotified).toBe(true);
    expect(result.restoredNotified).toBe(true);

    const status = await hal.getMeterStatus(TENANT_ID);
    expect(status.state).toBe('CONNECTED');
    expect(status.balanceMGrd).toBe(4_000);

    expect(notifications.events.map((e) => e.method)).toEqual([
      'sendPurchaseConfirmed',
      'sendRestoredNotice',
    ]);
  });
});

describe('ReconnectService — top-up after cutoff', () => {
  it('reconnects when prior balance was 0', async () => {
    const { service, hal, repo, notifications } = makeRig();
    repo._seedForTest({ tenantId: TENANT_ID, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: 0 });

    const result = await service.handlePaymentConfirmed({
      tenantId: TENANT_ID,
      tenantPhone: PHONE,
      amountNgn: 5000,
      mGrdMinted: 4_000,
    });

    expect(result.reconnected).toBe(true);
    expect(result.restoredNotified).toBe(true);
    const status = await hal.getMeterStatus(TENANT_ID);
    expect(status.state).toBe('CONNECTED');
    expect(notifications.events.map((e) => e.method)).toEqual([
      'sendPurchaseConfirmed',
      'sendRestoredNotice',
    ]);
  });
});

describe('ReconnectService — top-up while still connected', () => {
  it('mints + sends purchase confirmed; does NOT reconnect or send restored', async () => {
    const { service, hal, repo, notifications } = makeRig();
    repo._seedForTest({ tenantId: TENANT_ID, balanceMGrd: 1_000, state: 'CONNECTED', lastUpdatedAt: 0 });

    const result = await service.handlePaymentConfirmed({
      tenantId: TENANT_ID,
      tenantPhone: PHONE,
      amountNgn: 5000,
      mGrdMinted: 4_000,
    });

    expect(result.mGrdMinted).toBe(4_000);
    expect(result.balanceAfterMGrd).toBe(5_000);
    expect(result.reconnected).toBe(false);
    expect(result.purchaseNotified).toBe(true);
    expect(result.restoredNotified).toBe(false);

    const status = await hal.getMeterStatus(TENANT_ID);
    expect(status.state).toBe('CONNECTED');
    expect(notifications.events.map((e) => e.method)).toEqual(['sendPurchaseConfirmed']);
  });
});

describe('ReconnectService — failure paths', () => {
  it('throws if mint fails (data integrity issue — caller should NOT ack 200)', async () => {
    const { service, repo } = makeRig();
    // Seed with createIfMissing=false expectation will still create on first mint due to opts.createIfMissing
    // We need to provoke a mint failure another way. Use an invalid amount.
    repo._seedForTest({ tenantId: TENANT_ID, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: 0 });

    await expect(
      service.handlePaymentConfirmed({
        tenantId: TENANT_ID,
        tenantPhone: PHONE,
        amountNgn: 5000,
        mGrdMinted: -100, // invalid — HAL will throw HalArgumentError
      }),
    ).rejects.toThrow();
  });

  it('still returns success structure when restored notification fails', async () => {
    const { service, notifications } = makeRig();
    notifications.shouldFailRestored = true;

    const result = await service.handlePaymentConfirmed({
      tenantId: TENANT_ID,
      tenantPhone: PHONE,
      amountNgn: 5000,
      mGrdMinted: 4_000,
    });

    expect(result.reconnected).toBe(true);          // relay still flipped
    expect(result.restoredNotified).toBe(false);    // notif failed
    expect(result.purchaseNotified).toBe(true);     // first notif succeeded
  });
});
