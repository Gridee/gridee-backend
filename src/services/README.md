# Services (`gridee-backend/src/services/`)

Domain orchestrators — they compose the HAL, NotificationService, and other primitives into the actual business workflows.

## Files

| File | Role |
|---|---|
| `ConsumptionService.ts` | Hourly consumption tick — deduct, alert, cutoff |
| `ReconnectService.ts` | Post-payment-confirmed — mint, reconnect, notify |
| `PaymentExpiryService.ts` | Sweeps PENDING payments older than TTL (default 15 min) → EXPIRED |
| `ITenantDirectory.ts` | Lookup of active tenants for the cron + InMemory impl |
| `index.ts` | Public exports |

## ConsumptionService

The brain of the hourly cron. For each active tenant:

```
┌──────────────────────────────────────────────────────────────────┐
│ ConsumptionService.tickOne(tenant)                               │
│                                                                   │
│ 1. status = hal.getMeterStatus(tenant)                           │
│    └ if CUTOFF → skip (no consumption while disconnected)        │
│                                                                   │
│ 2. d = hal.deductConsumption(tenant, kwh)                        │
│                                                                   │
│ 3. if d.crossedZero:                                             │
│      a. notifications.sendCutoffNotice(tenant.phone)             │
│      b. hal.cutOff(tenant)  ← idempotent; survives notif failure │
│                                                                   │
│    elif d.balanceAfter < threshold AND was above before:         │
│      notifications.sendLowBalanceAlert(tenant.phone, balance)    │
│                                                                   │
│ Return TickOutcome  ← never throws                               │
└──────────────────────────────────────────────────────────────────┘
```

Failure isolation:
- One tenant's HAL error doesn't fail the batch — caught and recorded in TickOutcome
- Notification failure does NOT block cutoff — relay still flips
- Cutoff failure logs loudly; user keeps power for one tick (next tick retries)

Concurrency:
- Bounded parallelism via `concurrency` option (default 10)
- Output order matches input order (deterministic for tests)

Hysteresis:
- Low-balance alert fires only on the tick where balance crosses below threshold (downward)
- Tenant who tops up and consumes back down again gets a fresh alert (intended)

## ReconnectService

Called by the Flutterwave webhook handler AFTER signature verification, idempotency check, and payment row commit.

```
┌──────────────────────────────────────────────────────────────────┐
│ ReconnectService.handlePaymentConfirmed({ tenantId, ... })       │
│                                                                   │
│ 1. mintRes = hal.mint(tenantId, mGrd)  ← THROWS on failure       │
│    (data integrity issue — webhook handler should NOT ack 200)   │
│                                                                   │
│ 2. notifications.sendPurchaseConfirmed(...)  ← non-throwing      │
│                                                                   │
│ 3. if mintRes.wasDepleted:                                       │
│      a. hal.reconnect(tenantId)                                  │
│      b. notifications.sendRestoredNotice(...)                    │
│                                                                   │
│ Return PaymentConfirmedResult                                    │
└──────────────────────────────────────────────────────────────────┘
```

The split between "always send purchase confirmed" and "send restored only if wasDepleted" is exactly what SCREENS.md prescribes.

## Test coverage

41 tests across both services covering:
- All branches of the consumption tick state machine
- 12-tick simulation: alert at exactly the crossing tick, cutoff at zero, no duplicates
- Failure isolation (HAL error, notification error, cutoff error)
- Bounded concurrency with 50 tenants
- ReconnectService: first-time top-up, post-cutoff top-up, top-up while connected
- Mint failure throws (caller should NOT ack 200)
- Notification failure doesn't undo the relay flip

## PaymentExpiryService

Drains stale PENDING payments. Called by the `pendingPaymentExpiry` cron every 5 minutes.

```
┌──────────────────────────────────────────────────────────────────┐
│ PaymentExpiryService.sweep()                                     │
│                                                                   │
│ 1. listStalePending(olderThan = now - ttlMs, limit = 1000)       │
│ 2. for each candidate:                                           │
│      try: transitionStatus(EXPIRED)                              │
│        ok → notifications.sendPaymentFailed(tenant, "timed out") │
│        PaymentStateError → "alreadyResolved" (webhook beat us)   │
│        other error → log, continue with next                     │
│ 3. return ExpirySweepResult { candidates, expired, ... }         │
└──────────────────────────────────────────────────────────────────┘
```

Race with webhook handler:
- Sweep lists row R as stale at t=0
- Between t=0 and t=10ms, a Flutterwave webhook arrives and confirms R
- Sweep tries to transition R to EXPIRED → `PaymentStateError`
- Sweep treats it as `alreadyResolved`, NO notification (the webhook's notification path handles it)

This is the system working as designed; tests confirm both branches.
