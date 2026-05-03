# Hardware Abstraction Layer (`gridee-backend/src/hal/`)

The seam between business logic (consumption engine, payment webhook reconnect, notification triggers) and the (eventual) physical meter. The MVP uses a fully in-memory implementation; the production hardware impl will drop in without touching any caller.

## Files

| File | Role |
|---|---|
| `types.ts` | `TenantId` brand, mGRD integer math, `MeterStatus`, `DeductionResult`, etc. |
| `errors.ts` | `HalError` hierarchy |
| `IEnergyBalanceRepository.ts` | Data layer interface + `InMemoryEnergyBalanceRepository` |
| `IHardwareLayer.ts` | The HAL contract |
| `MockHardwareLayer.ts` | MVP impl, backed by the repository |
| `HardwareLayerFactory.ts` | `create({ type })` — currently only `mock`; `mqtt` later |
| `index.ts` | Public exports |

## Three-layer split

```
┌─────────────────────────────────────────────┐
│ Caller: ConsumptionService, payment webhook  │
└──────────────────────┬──────────────────────┘
                       │ deductConsumption / mint / cutOff / reconnect
                       ▼
┌─────────────────────────────────────────────┐
│ IHardwareLayer (logic)                       │
│  - business rules (idempotency, state guards)│
│  - converts kWh ↔ mGRD                        │
└──────────────────────┬──────────────────────┘
                       │ get / upsert / applyDelta / setState
                       ▼
┌─────────────────────────────────────────────┐
│ IEnergyBalanceRepository (data)             │
│  - atomic read-modify-write                  │
│  - integer mGRD storage                      │
└─────────────────────────────────────────────┘
```

Each layer has a single responsibility:
- **HAL** is logic. Validates inputs, enforces "can't reconnect at zero", reports `crossedZero`.
- **Repository** is atomicity. The read-modify-write window IS the lock seam.

This split means we get to write a clean Postgres repo later without touching the HAL — and the HAL is fully unit-testable today against an in-memory repo.

## Why mGRD integers, not GRD floats

The consumption engine fires every hour, deducting `0.5` kWh per tenant. After 1000 ticks: `1000 × 0.5 = 500.00000000000045` in JS. Five years of this and balances drift in unpredictable ways.

Solution: **store in integer milli-GRD** (mGRD). 1 GRD = 1000 mGRD = 1 kWh.

```typescript
// Outside the HAL: GRD floats are fine for display
const grdShown = toGrd(status.balanceMGrd);  // 5.5

// Inside the HAL: mGRD integers, always
await hal.deductConsumption(tenantId, 0.5);  // converted to 500 mGRD internally
await hal.mint(tenantId, 5000);              // 5 GRD
```

Test for this: 1000 sequential 0.5-kWh deductions land on `500.000` GRD exactly. No drift.

## Idempotent state transitions

The consumption job runs hourly. It computes who needs cutoff, fires notifications, then calls `cutOff` for each. If the job retries (cron restart, partial failure), `cutOff` is called twice for some tenants. Without idempotency the second call would double-publish an MQTT command later, or worse, race the user's recent top-up.

So:

| Method | Idempotent? | Behavior on no-op |
|---|---|---|
| `cutOff(t)` | yes | returns `{ changed: false, state: 'CUTOFF' }` |
| `reconnect(t)` (CONNECTED already) | yes | returns `{ changed: false, state: 'CONNECTED' }` |
| `reconnect(t)` (balance ≤ 0) | n/a | **throws** `CannotReconnectZeroBalanceError` |
| `mint(t, n)` | NO — each call adds n | (caller deduplicates with payment idempotency keys) |
| `deductConsumption(t, n)` | NO — each call deducts n | (caller deduplicates via cron run-key, future) |

## What the HAL does NOT do

- **Auto-cutoff on cross-zero.** When a deduction crosses zero, the HAL returns `crossedZero: true` but does NOT flip state. The orchestrator (ConsumptionService) decides — that lets it batch-fire notifications first, then send relay commands in one MQTT round-trip later.
- **Auto-reconnect on top-up.** Same reason: the orchestrator decides. `mint` returns `wasDepleted: true` to signal the cue.
- **Notifications.** That's `NotificationService`'s job; the HAL just reports outcomes.
- **Payment-side concerns.** It mints whatever you tell it to; payment idempotency lives in the webhook handler.

## Future: MQTT impl

When real meters arrive, `MqttHardwareLayer` implements the same `IHardwareLayer`. Its `cutOff` publishes to `gridee/meters/{tenantId}/cmd` and waits for an ack on `gridee/meters/{tenantId}/ack` — but the caller doesn't change at all. The factory adds `'mqtt'` and the MVP keeps working under `'mock'` for staging.

## Test coverage

37 tests covering:
- mGRD integer math (no float drift)
- Repository atomicity under 100-way concurrency
- Failed ops don't poison the lock chain
- Every HAL method's happy path
- `crossedZero` distinguishes "exact" from "partial deduction"
- `wasDepleted` signals reconnect cue
- Idempotency of cutOff and reconnect
- `CannotReconnectZeroBalanceError` on zero-balance reconnect
- Tenant isolation (operations on T1 don't touch T2)
- End-to-end PRD lifecycle (mint → connect → consume × 9 → cross zero → cutoff → mint → reconnect)
