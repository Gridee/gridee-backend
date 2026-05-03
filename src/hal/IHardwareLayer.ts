import type {
  DeductionResult,
  MeterStatus,
  MintResult,
  StateChangeResult,
  TenantId,
} from './types';

/**
 * Hardware Abstraction Layer.
 *
 * The seam between business logic (ConsumptionService, payment webhook handler,
 * notification triggers) and the physical-or-virtual meter.
 *
 * MVP impl: `MockHardwareLayer` — backed by a database row.
 * Future impl: `MqttHardwareLayer` — publishes to MQTT topics, listens for
 * acks, talks to real meters.
 *
 * The interface is shaped so that the future MQTT impl drops in without any
 * caller changes. Specifically:
 *   - Methods are async (not "set this number" but "publish and wait for ack")
 *   - Results are structured objects (so failure modes can grow without
 *     breaking callers)
 *   - State-change methods return `changed: bool` so idempotent retries are
 *     safe (a real meter that already has the relay open shouldn't be told
 *     to "open" again)
 *
 * IDEMPOTENCY GUARANTEES:
 *   - cutOff(t)    — calling twice in a row leaves state CUTOFF, returns changed=false the second time
 *   - reconnect(t) — calling on a CONNECTED meter returns changed=false; calling on a CUTOFF meter with
 *                    balance > 0 transitions and returns changed=true; calling on CUTOFF with balance = 0
 *                    THROWS CannotReconnectZeroBalanceError
 */
export interface IHardwareLayer {
  /**
   * Deduct kWh consumption from a tenant's balance.
   *
   * On crossing zero: clamps balance at 0 and returns `crossedZero: true`.
   * The HAL does NOT auto-cut-off — the caller is expected to call cutOff()
   * if `crossedZero` is true. (This separation lets the consumption job
   * batch-fire all notifications THEN flip relays in one MQTT round-trip
   * later.)
   *
   * Throws TenantNotFoundError if no balance row exists for the tenant.
   */
  deductConsumption(tenantId: TenantId, kwh: number): Promise<DeductionResult>;

  /**
   * Mint GRD into a tenant's balance after payment confirmation.
   *
   * `createIfMissing: true` — if the tenant has no balance row yet (first
   * top-up after onboarding), create one at zero before applying the mint.
   *
   * Returns `wasDepleted: true` if the previous balance was 0 — caller uses
   * this to decide whether to also call reconnect().
   */
  mint(tenantId: TenantId, mGrd: number, opts?: { createIfMissing?: boolean }): Promise<MintResult>;

  /**
   * Read the current balance and state. Cheap operation; safe to call often.
   */
  getMeterStatus(tenantId: TenantId): Promise<MeterStatus>;

  /**
   * Open the relay (cut off power). Idempotent.
   */
  cutOff(tenantId: TenantId): Promise<StateChangeResult>;

  /**
   * Close the relay (restore power). Idempotent.
   * Throws CannotReconnectZeroBalanceError if balance is <= 0.
   */
  reconnect(tenantId: TenantId): Promise<StateChangeResult>;
}
