import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Branded types
// ─────────────────────────────────────────────────────────────────────────────

declare const tenantIdBrand: unique symbol;
export type TenantId = string & { readonly [tenantIdBrand]: true };

const TenantIdSchema = z.string().min(1).transform((v): TenantId => v as TenantId);
export const TenantId = {
  schema: TenantIdSchema,
  of(raw: string): TenantId {
    return TenantIdSchema.parse(raw);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Money / energy units
//
// We store balances in INTEGER milli-GRD (mGRD) to avoid floating-point drift.
// 1 GRD = 1 kWh = 1_000 mGRD.
//
// Convention:
//   - All HAL methods accept and return mGRD (integer)
//   - Display / API boundary converts to GRD (number) via toGrd()
//   - kWh-based methods (`deductKwh`) convert internally
// ─────────────────────────────────────────────────────────────────────────────

/** 1 GRD = 1000 milli-GRD. */
export const M_GRD_PER_GRD = 1000;

/** Convert mGRD (integer) to GRD (number, 3-decimal precision). */
export function toGrd(mGrd: number): number {
  return Math.round(mGrd) / M_GRD_PER_GRD;
}

/** Convert GRD (number) to mGRD (integer). Rounds to nearest. */
export function toMGrd(grd: number): number {
  if (!Number.isFinite(grd)) {
    throw new RangeError(`toMGrd: not a finite number: ${grd}`);
  }
  return Math.round(grd * M_GRD_PER_GRD);
}

/** Convert kWh consumption to mGRD (1 kWh = 1 GRD = 1000 mGRD). */
export function kwhToMGrd(kwh: number): number {
  return toMGrd(kwh);
}

// ─────────────────────────────────────────────────────────────────────────────
// Meter status
// ─────────────────────────────────────────────────────────────────────────────

export const MeterStateSchema = z.enum(['CONNECTED', 'CUTOFF']);
export type MeterState = z.infer<typeof MeterStateSchema>;

export interface MeterStatus {
  tenantId: TenantId;
  state: MeterState;
  /** Current balance in mGRD (integer). */
  balanceMGrd: number;
  /** Last time balance changed (epoch ms). */
  lastUpdatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result types — structured outcomes so callers can react precisely
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Outcome of a deduction. Always reports what HAPPENED, not what was asked for.
 *
 * If the requested amount exceeds the balance, we deduct what's available and
 * return `crossedZero: true` so the caller knows to cut off the meter.
 *
 * Example: balance 200 mGRD, deductConsumption(500 mGRD)
 *   → { mGrdDeducted: 200, balanceAfterMGrd: 0, crossedZero: true, partialDeduction: true }
 */
export interface DeductionResult {
  tenantId: TenantId;
  /** mGRD actually deducted (0..requested). May be less than requested if balance ran out. */
  mGrdDeducted: number;
  /** Balance AFTER the deduction (always >= 0). */
  balanceAfterMGrd: number;
  /** True if balance was > 0 before and became <= 0 after. */
  crossedZero: boolean;
  /** True if requested > balance, so we deducted only what was available. */
  partialDeduction: boolean;
  /** Final state of the meter after this deduction (CONNECTED or CUTOFF). HAL leaves cutoff to the caller — this just reflects current state. */
  state: MeterState;
}

/** Outcome of a mint operation (after payment confirmed). */
export interface MintResult {
  tenantId: TenantId;
  mGrdMinted: number;
  balanceAfterMGrd: number;
  /** True if the tenant was at zero balance before the mint (the caller usually wants to reconnect). */
  wasDepleted: boolean;
}

/** Outcome of a state-change call (cutOff/reconnect). */
export interface StateChangeResult {
  tenantId: TenantId;
  /** True if the call actually changed state, false if it was a no-op (already in target state). */
  changed: boolean;
  state: MeterState;
}
