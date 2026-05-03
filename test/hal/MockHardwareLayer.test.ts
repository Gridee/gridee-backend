import { describe, expect, it } from 'vitest';
import {
  CannotReconnectZeroBalanceError,
  HalArgumentError,
  TenantNotFoundError,
} from '../../src/hal/errors';
import {
  InMemoryEnergyBalanceRepository,
} from '../../src/hal/IEnergyBalanceRepository';
import { MockHardwareLayer } from '../../src/hal/MockHardwareLayer';
import { TenantId } from '../../src/hal/types';

const TENANT: TenantId = TenantId.of('tenant_1');
const OTHER: TenantId = TenantId.of('tenant_2');

function makeHal(): {
  hal: MockHardwareLayer;
  repo: InMemoryEnergyBalanceRepository;
} {
  const repo = new InMemoryEnergyBalanceRepository({ clock: () => 1_700_000_000_000 });
  const hal = new MockHardwareLayer({ repository: repo, clock: () => 1_700_000_000_000 });
  return { hal, repo };
}

// ─── deductConsumption ─────────────────────────────────────────────────────

describe('deductConsumption', () => {
  it('deducts exactly when balance is sufficient', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 5000, state: 'CONNECTED', lastUpdatedAt: 0 });

    const result = await hal.deductConsumption(TENANT, 0.5); // 500 mGRD

    expect(result.mGrdDeducted).toBe(500);
    expect(result.balanceAfterMGrd).toBe(4500);
    expect(result.crossedZero).toBe(false);
    expect(result.partialDeduction).toBe(false);
    expect(result.state).toBe('CONNECTED');
  });

  it('reports crossedZero when balance hits exactly zero', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 500, state: 'CONNECTED', lastUpdatedAt: 0 });

    const result = await hal.deductConsumption(TENANT, 0.5); // exactly 500

    expect(result.balanceAfterMGrd).toBe(0);
    expect(result.crossedZero).toBe(true);
    expect(result.partialDeduction).toBe(false); // exact, no clamp
  });

  it('reports partialDeduction + crossedZero when requested > balance', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 200, state: 'CONNECTED', lastUpdatedAt: 0 });

    const result = await hal.deductConsumption(TENANT, 0.5); // 500 mGRD requested

    expect(result.mGrdDeducted).toBe(200); // only what was available
    expect(result.balanceAfterMGrd).toBe(0);
    expect(result.crossedZero).toBe(true);
    expect(result.partialDeduction).toBe(true);
  });

  it('does NOT report crossedZero when balance was already zero', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: 0 });

    const result = await hal.deductConsumption(TENANT, 0.5);
    expect(result.balanceAfterMGrd).toBe(0);
    expect(result.crossedZero).toBe(false); // was already 0
    expect(result.partialDeduction).toBe(true);
  });

  it('zero kWh is a no-op (returns current state, no deduction)', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 500, state: 'CONNECTED', lastUpdatedAt: 0 });

    const result = await hal.deductConsumption(TENANT, 0);
    expect(result.mGrdDeducted).toBe(0);
    expect(result.balanceAfterMGrd).toBe(500);
    expect(result.crossedZero).toBe(false);
    expect(result.partialDeduction).toBe(false);
  });

  it('throws on negative kWh', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 500, state: 'CONNECTED', lastUpdatedAt: 0 });
    await expect(hal.deductConsumption(TENANT, -0.1)).rejects.toThrow(HalArgumentError);
  });

  it('throws on NaN/Infinity kWh', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 500, state: 'CONNECTED', lastUpdatedAt: 0 });
    await expect(hal.deductConsumption(TENANT, NaN)).rejects.toThrow(HalArgumentError);
    await expect(hal.deductConsumption(TENANT, Infinity)).rejects.toThrow(HalArgumentError);
  });

  it('throws TenantNotFoundError when tenant has no row', async () => {
    const { hal } = makeHal();
    await expect(hal.deductConsumption(TENANT, 0.5)).rejects.toThrow(TenantNotFoundError);
  });

  it('does NOT auto-cutoff when crossedZero (caller must do it)', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 500, state: 'CONNECTED', lastUpdatedAt: 0 });
    await hal.deductConsumption(TENANT, 0.5);
    const status = await hal.getMeterStatus(TENANT);
    expect(status.state).toBe('CONNECTED'); // still connected — caller's job
  });
});

// ─── mint ──────────────────────────────────────────────────────────────────

describe('mint', () => {
  it('mints into existing balance', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 1000, state: 'CONNECTED', lastUpdatedAt: 0 });

    const result = await hal.mint(TENANT, 5000);
    expect(result.mGrdMinted).toBe(5000);
    expect(result.balanceAfterMGrd).toBe(6000);
    expect(result.wasDepleted).toBe(false);
  });

  it('reports wasDepleted=true when balance was zero', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: 0 });

    const result = await hal.mint(TENANT, 4000);
    expect(result.wasDepleted).toBe(true);
    expect(result.balanceAfterMGrd).toBe(4000);
  });

  it('creates row on first mint when createIfMissing=true (default)', async () => {
    const { hal } = makeHal();
    const result = await hal.mint(TENANT, 1000);
    expect(result.balanceAfterMGrd).toBe(1000);
    // First mint sets state to CUTOFF (caller must reconnect)
    const status = await hal.getMeterStatus(TENANT);
    expect(status.state).toBe('CUTOFF');
  });

  it('throws when tenant absent and createIfMissing=false', async () => {
    const { hal } = makeHal();
    await expect(hal.mint(TENANT, 1000, { createIfMissing: false })).rejects.toThrow(TenantNotFoundError);
  });

  it.each([0, -100, 1.5, NaN, Infinity])('rejects invalid mint amount: %s', async (bad) => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: 0 });
    await expect(hal.mint(TENANT, bad)).rejects.toThrow(HalArgumentError);
  });
});

// ─── getMeterStatus ───────────────────────────────────────────────────────

describe('getMeterStatus', () => {
  it('returns current state and balance', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 2500, state: 'CONNECTED', lastUpdatedAt: 1234 });
    const status = await hal.getMeterStatus(TENANT);
    expect(status).toEqual({
      tenantId: TENANT,
      state: 'CONNECTED',
      balanceMGrd: 2500,
      lastUpdatedAt: 1234,
    });
  });

  it('throws when tenant has no row', async () => {
    const { hal } = makeHal();
    await expect(hal.getMeterStatus(TENANT)).rejects.toThrow(TenantNotFoundError);
  });
});

// ─── cutOff ───────────────────────────────────────────────────────────────

describe('cutOff', () => {
  it('transitions CONNECTED → CUTOFF and returns changed=true', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 100, state: 'CONNECTED', lastUpdatedAt: 0 });
    const r = await hal.cutOff(TENANT);
    expect(r.changed).toBe(true);
    expect(r.state).toBe('CUTOFF');
  });

  it('is idempotent: second call returns changed=false', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 100, state: 'CUTOFF', lastUpdatedAt: 0 });
    const r = await hal.cutOff(TENANT);
    expect(r.changed).toBe(false);
    expect(r.state).toBe('CUTOFF');
  });

  it('throws when tenant has no row', async () => {
    const { hal } = makeHal();
    await expect(hal.cutOff(TENANT)).rejects.toThrow(TenantNotFoundError);
  });
});

// ─── reconnect ────────────────────────────────────────────────────────────

describe('reconnect', () => {
  it('transitions CUTOFF → CONNECTED when balance > 0', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 1000, state: 'CUTOFF', lastUpdatedAt: 0 });
    const r = await hal.reconnect(TENANT);
    expect(r.changed).toBe(true);
    expect(r.state).toBe('CONNECTED');
  });

  it('refuses to reconnect at zero balance', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: 0 });
    await expect(hal.reconnect(TENANT)).rejects.toThrow(CannotReconnectZeroBalanceError);
  });

  it('is idempotent on already-connected with balance', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 1000, state: 'CONNECTED', lastUpdatedAt: 0 });
    const r = await hal.reconnect(TENANT);
    expect(r.changed).toBe(false);
    expect(r.state).toBe('CONNECTED');
  });

  it('throws when tenant has no row', async () => {
    const { hal } = makeHal();
    await expect(hal.reconnect(TENANT)).rejects.toThrow(TenantNotFoundError);
  });
});

// ─── End-to-end consumption cycle ─────────────────────────────────────────

describe('end-to-end consumption + top-up cycle', () => {
  it('models the PRD lifecycle: mint → connect → consume → cutoff → mint → reconnect', async () => {
    const { hal } = makeHal();

    // 1. First top-up of 5 GRD (5000 mGRD) — creates row at CUTOFF.
    const m1 = await hal.mint(TENANT, 5000);
    expect(m1.balanceAfterMGrd).toBe(5000);
    expect(m1.wasDepleted).toBe(true);
    expect((await hal.getMeterStatus(TENANT)).state).toBe('CUTOFF');

    // 2. Reconnect — caller's job after first mint.
    const c1 = await hal.reconnect(TENANT);
    expect(c1.state).toBe('CONNECTED');

    // 3. Consume 9 × 0.5 kWh = 4500 mGRD over 9 hourly ticks.
    for (let i = 0; i < 9; i++) {
      const r = await hal.deductConsumption(TENANT, 0.5);
      expect(r.crossedZero).toBe(false);
    }
    expect((await hal.getMeterStatus(TENANT)).balanceMGrd).toBe(500);

    // 4. One more tick crosses zero exactly.
    const last = await hal.deductConsumption(TENANT, 0.5);
    expect(last.crossedZero).toBe(true);
    expect(last.balanceAfterMGrd).toBe(0);

    // 5. Caller cuts off.
    const co = await hal.cutOff(TENANT);
    expect(co.changed).toBe(true);

    // 6. New top-up — balance back to 3000.
    const m2 = await hal.mint(TENANT, 3000);
    expect(m2.wasDepleted).toBe(true); // was zero pre-mint
    expect(m2.balanceAfterMGrd).toBe(3000);

    // 7. Reconnect.
    const c2 = await hal.reconnect(TENANT);
    expect(c2.changed).toBe(true);
    expect(c2.state).toBe('CONNECTED');
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('operations on one tenant do not affect another', async () => {
    const { hal, repo } = makeHal();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 5000, state: 'CONNECTED', lastUpdatedAt: 0 });
    repo._seedForTest({ tenantId: OTHER, balanceMGrd: 1000, state: 'CONNECTED', lastUpdatedAt: 0 });

    await hal.deductConsumption(TENANT, 1);
    await hal.cutOff(TENANT);

    const otherStatus = await hal.getMeterStatus(OTHER);
    expect(otherStatus.balanceMGrd).toBe(1000);
    expect(otherStatus.state).toBe('CONNECTED');
  });
});
