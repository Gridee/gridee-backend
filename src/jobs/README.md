# Jobs (`gridee-backend/src/jobs/`)

Cron entry points — thin wrappers around services.

## Files

| File | Role |
|---|---|
| `consumptionEngine.ts` | Hourly cron that calls `ConsumptionService.tick()` |
| `pendingPaymentExpiry.ts` | Every-5-minutes cron that calls `PaymentExpiryService.sweep()` |
| `index.ts` | Public exports |

## consumptionEngine

```typescript
import { startConsumptionEngine } from './jobs';
import { ConsumptionService } from './services';

const engine = startConsumptionEngine({
  service: consumptionService,
  schedule: '0 * * * *',  // every hour at minute 0 (default)
  runOnStart: false,       // also fire once at boot (useful for demos)
});

// Manual trigger (tests, ops debug)
await engine.triggerNow();

// Graceful shutdown
engine.stop();
```

## Guarantees

- **No overlap**: if a previous tick is still running when the next fire arrives, the new fire is **skipped** with a warning log. Prevents stacked runs from hammering the DB on a slow run.
- **Crash isolation**: if the service throws, the cron continues firing on schedule. We log loudly but never crash the process.
- **Schedule validation**: invalid cron expressions throw at construction, not at the first fire.
- **Idempotent stop**: `engine.stop()` is safe to call multiple times.

## pendingPaymentExpiry

```typescript
import { startPaymentExpiryEngine } from './jobs';
import { PaymentExpiryService } from './services';

const engine = startPaymentExpiryEngine({
  service: paymentExpiryService,
  schedule: '*/5 * * * *',  // every 5 min (default)
  runOnStart: false,
});
```

TTL default is 15 minutes. With a 5-min sweep cadence, a stale payment is detected within at most 5 minutes after crossing the threshold. Tunable via `PaymentExpiryService` constructor options.

## What's NOT here yet

- **Reconciliation** — every 5 min, compare cached `energy_balances.balance_mGrd` to source-of-truth (e.g. on-chain GWATT total). Useful when the chain is the ledger; for MVP the repo IS the source of truth, so deferred.

## Test coverage

13 tests across both crons covering:
- Invalid cron schedule throws at startup
- `triggerNow()` runs the service
- Concurrent fires are SKIPPED
- Service throw doesn't crash the cron
- `runOnStart` fires once at boot
- `stop()` is idempotent
