import { logger } from '../lib/logger';
import {
  CannotReconnectZeroBalanceError,
  HalArgumentError,
  TenantNotFoundError,
} from './errors';
import type { IEnergyBalanceRepository } from './IEnergyBalanceRepository';
import type { IHardwareLayer } from './IHardwareLayer';
import {
  kwhToMGrd,
  type DeductionResult,
  type MeterStatus,
  type MintResult,
  type StateChangeResult,
  type TenantId,
} from './types';

export interface MockHardwareLayerOptions {
  repository: IEnergyBalanceRepository;
  /** Optional clock for deterministic tests. */
  clock?: () => number;
}

/**
 * MVP implementation of IHardwareLayer. Backed entirely by
 * IEnergyBalanceRepository — no MQTT, no real meter.
 *
 * The repository's `applyDelta` is the atomicity primitive; this class just
 * shapes inputs/outputs and enforces business rules (idempotency, can't
 * reconnect at zero, etc.).
 */
export class MockHardwareLayer implements IHardwareLayer {
  private readonly repo: IEnergyBalanceRepository;
  private readonly log: typeof logger;

  constructor(opts: MockHardwareLayerOptions) {
    this.repo = opts.repository;
    this.log = logger.child({ component: 'MockHardwareLayer' });
  }

  // ─── Deduction ────────────────────────────────────────────────────────

  async deductConsumption(tenantId: TenantId, kwh: number): Promise<DeductionResult> {
    if (!Number.isFinite(kwh) || kwh < 0) {
      throw new HalArgumentError(`kwh must be a non-negative finite number, got ${kwh}`);
    }
    if (kwh === 0) {
      // No-op: read current state, return zero-deduction result
      const current = await this.repo.get(tenantId);
      if (!current) throw new TenantNotFoundError(tenantId);
      return {
        tenantId,
        mGrdDeducted: 0,
        balanceAfterMGrd: current.balanceMGrd,
        crossedZero: false,
        partialDeduction: false,
        state: current.state,
      };
    }

    const requestedMGrd = kwhToMGrd(kwh);
    const result = await this.repo.applyDelta({
      tenantId,
      deltaMGrd: -requestedMGrd,
      createIfMissing: false,
    });

    if (result === null) throw new TenantNotFoundError(tenantId);

    const { row, clampedToZero, balanceBeforeMGrd, appliedMGrd } = result;
    // Note: appliedMGrd is signed. For deduction it's negative; mGrdDeducted
    // is the positive magnitude.
    const mGrdDeducted = Math.abs(appliedMGrd);
    const crossedZero = balanceBeforeMGrd > 0 && row.balanceMGrd === 0;

    this.log.debug(
      {
        tenantId,
        kwh,
        requestedMGrd,
        mGrdDeducted,
        balanceBeforeMGrd,
        balanceAfterMGrd: row.balanceMGrd,
        crossedZero,
        clampedToZero,
      },
      'deductConsumption',
    );

    return {
      tenantId,
      mGrdDeducted,
      balanceAfterMGrd: row.balanceMGrd,
      crossedZero,
      partialDeduction: clampedToZero,
      state: row.state,
    };
  }

  // ─── Mint ─────────────────────────────────────────────────────────────

  async mint(
    tenantId: TenantId,
    mGrd: number,
    opts: { createIfMissing?: boolean } = {},
  ): Promise<MintResult> {
    if (!Number.isInteger(mGrd) || mGrd <= 0) {
      throw new HalArgumentError(`mint amount must be a positive integer (mGRD), got ${mGrd}`);
    }
    const createIfMissing = opts.createIfMissing ?? true;

    const result = await this.repo.applyDelta({
      tenantId,
      deltaMGrd: mGrd,
      createIfMissing,
    });

    if (result === null) {
      // createIfMissing was false and tenant didn't exist
      throw new TenantNotFoundError(tenantId);
    }

    const wasDepleted = result.balanceBeforeMGrd === 0;

    this.log.debug(
      {
        tenantId,
        mGrdMinted: mGrd,
        balanceBeforeMGrd: result.balanceBeforeMGrd,
        balanceAfterMGrd: result.row.balanceMGrd,
        wasDepleted,
      },
      'mint',
    );

    return {
      tenantId,
      mGrdMinted: mGrd,
      balanceAfterMGrd: result.row.balanceMGrd,
      wasDepleted,
    };
  }

  // ─── Status ───────────────────────────────────────────────────────────

  async getMeterStatus(tenantId: TenantId): Promise<MeterStatus> {
    const row = await this.repo.get(tenantId);
    if (!row) throw new TenantNotFoundError(tenantId);
    return {
      tenantId: row.tenantId,
      state: row.state,
      balanceMGrd: row.balanceMGrd,
      lastUpdatedAt: row.lastUpdatedAt,
    };
  }

  // ─── State changes ────────────────────────────────────────────────────

  async cutOff(tenantId: TenantId): Promise<StateChangeResult> {
    const result = await this.repo.setState(tenantId, 'CUTOFF');
    if (!result.row) throw new TenantNotFoundError(tenantId);
    if (result.changed) {
      this.log.info({ tenantId }, 'cutOff: relay opened');
    }
    return { tenantId, changed: result.changed, state: result.row.state };
  }

  async reconnect(tenantId: TenantId): Promise<StateChangeResult> {
    const current = await this.repo.get(tenantId);
    if (!current) throw new TenantNotFoundError(tenantId);
    if (current.balanceMGrd <= 0) {
      throw new CannotReconnectZeroBalanceError(tenantId);
    }
    const result = await this.repo.setState(tenantId, 'CONNECTED');
    if (!result.row) throw new TenantNotFoundError(tenantId); // raced with deletion
    if (result.changed) {
      this.log.info({ tenantId }, 'reconnect: relay closed');
    }
    return { tenantId, changed: result.changed, state: result.row.state };
  }
}
