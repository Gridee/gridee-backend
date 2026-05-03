import { GrideeError } from '../lib/errors';

export class HalError extends GrideeError {}

/** Tenant has no balance row in the repository. Caller must mint first. */
export class TenantNotFoundError extends HalError {
  constructor(public readonly tenantId: string) {
    super(`No balance record for tenant: ${tenantId}`);
  }
}

/** Reconnect was attempted but balance is still <= 0. */
export class CannotReconnectZeroBalanceError extends HalError {
  constructor(public readonly tenantId: string) {
    super(`Cannot reconnect tenant ${tenantId}: balance is zero or negative`);
  }
}

/** Caller passed a non-finite or negative argument that is not allowed. */
export class HalArgumentError extends HalError {}

/** The repository (DB, future MQTT broker) is unavailable. */
export class HalInfrastructureError extends HalError {}
