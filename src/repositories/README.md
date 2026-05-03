# Repositories (`gridee-backend/src/repositories/`)

Data layer for entities owned by this slice of the backend.

## Files

| File | Role |
|---|---|
| `PaymentTypes.ts` | Branded `PaymentId`, `PaymentStatus`, `PaymentRecord` |
| `IPaymentRepository.ts` | Interface + `InMemoryPaymentRepository` |
| `index.ts` | Public exports |

## Payment state machine

```
        ┌─────────────────────────────────────────┐
        │              PENDING                     │
        │  (created at /payments/initiate)        │
        └────┬─────────────┬────────────────┬────┘
             │             │                │
   webhook   │  webhook    │   sweeper      │
   confirmed │  failed     │   (15-min TTL) │
             ▼             ▼                ▼
        CONFIRMED       FAILED          EXPIRED
        (terminal)     (terminal)      (terminal)
```

`transitionStatus` is the ONLY way to move out of PENDING. Atomicity is the implementation's responsibility:
- **InMemory**: synchronous JS, no race
- **Postgres** (future): `UPDATE payments SET status = $1 WHERE id = $2 AND status = 'PENDING' RETURNING *`

Transitioning a non-PENDING row throws `PaymentStateError`. The webhook handler catches this and returns `already_terminal` instead of double-crediting.

## Why InMemory

Same pattern as the session store, the energy balance repo, and the messaging factory. Tests use it directly; the cron and webhook handler accept the interface and don't care about the impl.

The Postgres impl will live next to this file (e.g., `PostgresPaymentRepository.ts`) once Ganiyat finalizes the schema.

## Test coverage

12 tests covering:
- Create + get round-trip (by id and by txRef)
- Duplicate paymentId / txRef rejection
- All PENDING → terminal transitions (CONFIRMED, FAILED with reason, EXPIRED)
- Terminal-state transitions reject (CONFIRMED → CONFIRMED, FAILED → CONFIRMED, etc.)
- PaymentNotFoundError for missing ids
