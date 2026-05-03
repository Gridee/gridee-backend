import { describe, expect, it } from 'vitest';
import {
  InMemoryEnergyBalanceRepository,
  type IEnergyBalanceRepository,
} from '../../src/hal/IEnergyBalanceRepository';
import { HalArgumentError } from '../../src/hal/errors';
import { TenantId } from '../../src/hal/types';

const TENANT: TenantId = TenantId.of('tenant_1');

function makeRepo(): IEnergyBalanceRepository & InMemoryEnergyBalanceRepository {
  return new InMemoryEnergyBalanceRepository({ clock: () => 1_700_000_000_000 });
}

describe('InMemoryEnergyBalanceRepository — basic', () => {
  it('returns null for absent tenant', async () => {
    const repo = makeRepo();
    expect(await repo.get(TENANT)).toBeNull();
  });

  it('upsert + get round-trips', async () => {
    const repo = makeRepo();
    await repo.upsert({ tenantId: TENANT, balanceMGrd: 1500, state: 'CONNECTED', lastUpdatedAt: 1 });
    const row = await repo.get(TENANT);
    expect(row).toEqual({
      tenantId: TENANT,
      balanceMGrd: 1500,
      state: 'CONNECTED',
      lastUpdatedAt: 1,
    });
  });

  it('upsert rejects negative balance', async () => {
    const repo = makeRepo();
    await expect(
      repo.upsert({ tenantId: TENANT, balanceMGrd: -1, state: 'CONNECTED', lastUpdatedAt: 0 }),
    ).rejects.toThrow(HalArgumentError);
  });

  it('upsert rejects non-integer balance', async () => {
    const repo = makeRepo();
    await expect(
      repo.upsert({ tenantId: TENANT, balanceMGrd: 1.5, state: 'CONNECTED', lastUpdatedAt: 0 }),
    ).rejects.toThrow(HalArgumentError);
  });
});

describe('applyDelta', () => {
  it('returns null when tenant absent and createIfMissing=false', async () => {
    const repo = makeRepo();
    const result = await repo.applyDelta({
      tenantId: TENANT,
      deltaMGrd: 100,
      createIfMissing: false,
    });
    expect(result).toBeNull();
  });

  it('creates row when createIfMissing=true', async () => {
    const repo = makeRepo();
    const result = await repo.applyDelta({
      tenantId: TENANT,
      deltaMGrd: 1000,
      createIfMissing: true,
    });
    expect(result).not.toBeNull();
    expect(result!.row.balanceMGrd).toBe(1000);
    expect(result!.row.state).toBe('CUTOFF'); // created at CUTOFF
    expect(result!.balanceBeforeMGrd).toBe(0);
    expect(result!.appliedMGrd).toBe(1000);
    expect(result!.clampedToZero).toBe(false);
  });

  it('clamps negative result at zero', async () => {
    const repo = makeRepo();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 200, state: 'CONNECTED', lastUpdatedAt: 0 });
    const result = await repo.applyDelta({
      tenantId: TENANT,
      deltaMGrd: -500, // would go to -300
      createIfMissing: false,
    });
    expect(result!.row.balanceMGrd).toBe(0);
    expect(result!.balanceBeforeMGrd).toBe(200);
    expect(result!.appliedMGrd).toBe(-200); // only 200 was actually applied
    expect(result!.clampedToZero).toBe(true);
  });

  it('rejects non-integer delta', async () => {
    const repo = makeRepo();
    await expect(
      repo.applyDelta({ tenantId: TENANT, deltaMGrd: 1.5, createIfMissing: true }),
    ).rejects.toThrow(HalArgumentError);
  });

  it('respects setState when provided', async () => {
    const repo = makeRepo();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 0, state: 'CUTOFF', lastUpdatedAt: 0 });
    const result = await repo.applyDelta({
      tenantId: TENANT,
      deltaMGrd: 1000,
      createIfMissing: false,
      setState: 'CONNECTED',
    });
    expect(result!.row.state).toBe('CONNECTED');
    expect(result!.row.balanceMGrd).toBe(1000);
  });
});

describe('setState', () => {
  it('returns changed=false when row absent', async () => {
    const repo = makeRepo();
    const r = await repo.setState(TENANT, 'CUTOFF');
    expect(r.changed).toBe(false);
    expect(r.row).toBeNull();
  });

  it('returns changed=false when already in target state', async () => {
    const repo = makeRepo();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 100, state: 'CONNECTED', lastUpdatedAt: 0 });
    const r = await repo.setState(TENANT, 'CONNECTED');
    expect(r.changed).toBe(false);
    expect(r.row?.state).toBe('CONNECTED');
  });

  it('returns changed=true and updates state on transition', async () => {
    const repo = makeRepo();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 100, state: 'CONNECTED', lastUpdatedAt: 0 });
    const r = await repo.setState(TENANT, 'CUTOFF');
    expect(r.changed).toBe(true);
    expect(r.row?.state).toBe('CUTOFF');
  });
});

describe('concurrency', () => {
  it('concurrent applyDelta calls do not race — sum is exact', async () => {
    const repo = makeRepo();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 0, state: 'CONNECTED', lastUpdatedAt: 0 });

    // Fire 100 concurrent +10 deltas. If the read-modify-write window leaks,
    // we'd see less than 1000 final.
    const ops = Array.from({ length: 100 }, () =>
      repo.applyDelta({ tenantId: TENANT, deltaMGrd: 10, createIfMissing: false }),
    );
    await Promise.all(ops);

    const row = await repo.get(TENANT);
    expect(row!.balanceMGrd).toBe(1000);
  });

  it('concurrent +1/-1 mix lands at the correct final balance', async () => {
    const repo = makeRepo();
    repo._seedForTest({ tenantId: TENANT, balanceMGrd: 500, state: 'CONNECTED', lastUpdatedAt: 0 });

    const adds = Array.from({ length: 50 }, () =>
      repo.applyDelta({ tenantId: TENANT, deltaMGrd: 1, createIfMissing: false }),
    );
    const subs = Array.from({ length: 50 }, () =>
      repo.applyDelta({ tenantId: TENANT, deltaMGrd: -1, createIfMissing: false }),
    );
    // Interleave
    await Promise.all([...adds, ...subs].sort(() => Math.random() - 0.5));

    const row = await repo.get(TENANT);
    expect(row!.balanceMGrd).toBe(500); // (500 + 50 - 50)
  });

  it('a failing op does not poison the lock chain', async () => {
    const repo = makeRepo();
    // First op fails by violating non-integer
    await expect(
      repo.applyDelta({ tenantId: TENANT, deltaMGrd: 1.5, createIfMissing: true }),
    ).rejects.toThrow();

    // Second op should still work
    const r = await repo.applyDelta({ tenantId: TENANT, deltaMGrd: 100, createIfMissing: true });
    expect(r!.row.balanceMGrd).toBe(100);
  });
});
