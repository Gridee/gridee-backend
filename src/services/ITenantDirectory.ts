import type { Phone } from '../lib/phone';
import type { TenantId } from '../hal';

/**
 * Minimal info about a tenant needed by the consumption engine.
 *
 * The full tenant record (DB) has more fields; this is the subset
 * `ConsumptionService` actually uses, so the directory can be backed by:
 *   - In-memory map (tests, MVP demo)
 *   - PostgreSQL `SELECT id, phone FROM tenants WHERE active = true`
 *   - Whatever Ganiyat lands when the tenant table is finalized
 */
export interface ActiveTenant {
  tenantId: TenantId;
  phone: Phone;
  /** kWh per hour for this tenant. Default consumption rate, configurable per property in future. */
  kwhPerHour: number;
}

/**
 * Lookup of currently-active tenants. The consumption engine calls
 * `listActive()` once per cron run.
 *
 * "Active" semantics:
 *   - Tenant is registered (has completed onboarding)
 *   - Tenant has not been removed
 *   - Note: CONNECTED vs CUTOFF state is NOT a directory concern; the HAL
 *     reports current state on `getMeterStatus`. The directory returns
 *     anyone the system should consider for ticking; the orchestrator
 *     skips CUTOFF tenants because they're not consuming power.
 */
export interface ITenantDirectory {
  listActive(): Promise<ActiveTenant[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation — for tests and MVP demo
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryTenantDirectory implements ITenantDirectory {
  private readonly tenants = new Map<string, ActiveTenant>();

  async listActive(): Promise<ActiveTenant[]> {
    return Array.from(this.tenants.values());
  }

  /** Setup helper — adds or replaces a tenant entry. */
  upsert(tenant: ActiveTenant): void {
    this.tenants.set(tenant.tenantId, tenant);
  }

  /** Setup helper — removes a tenant entry. */
  remove(tenantId: TenantId): void {
    this.tenants.delete(tenantId);
  }

  /** Test helper. */
  size(): number {
    return this.tenants.size;
  }
}
