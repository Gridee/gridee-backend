# Payment Webhooks (`gridee-backend/src/webhooks/`)

Receives Flutterwave webhook deliveries, verifies them, and triggers the post-payment side effects (mint, reconnect, notify).

## Files

| File | Role |
|---|---|
| `IPaymentProvider.ts` | Provider abstraction (signature verify + event parsing) |
| `FlutterwavePaymentProvider.ts` | Flutterwave-specific impl |
| `IWebhookIdempotencyStore.ts` | Interface + InMemory + Redis impls + factory |
| `PaymentWebhookHandler.ts` | Orchestrator — verify → idempotency → state machine → ReconnectService |
| `route.ts` | Express route mount with route-scoped `express.raw()` |
| `index.ts` | Public exports |

## End-to-end lifecycle

```
       Flutterwave POST /webhooks/flutterwave
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Express route (raw body)                                            │
│   ┌────────────────────────────────────────────────────────────┐    │
│   │ PaymentWebhookHandler.handle(rawBody, signature)           │    │
│   │                                                            │    │
│   │ 1. provider.verifySignature       invalid → 401            │    │
│   │                                                            │    │
│   │ 2. provider.parseEvent            bad json → parse_error   │    │
│   │                                   non-charge → irrelevant  │    │
│   │                                                            │    │
│   │ 3. idempotencyStore.markProcessed already seen → duplicate │    │
│   │                                                            │    │
│   │ 4. paymentRepo.getByTxRef         missing → unknown_payment│    │
│   │                                                            │    │
│   │ 5. validate amount + currency     mismatch → mark FAILED   │    │
│   │                                                            │    │
│   │ 6. paymentRepo.transitionStatus   already done → terminal  │    │
│   │                                                            │    │
│   │ 7a. completed →                                            │    │
│   │      reconnectService.handlePaymentConfirmed()             │    │
│   │       └─ mints + reconnects + sends notifications          │    │
│   │      mint failed → 500 (FW retries)                        │    │
│   │                                                            │    │
│   │ 7b. failed →                                               │    │
│   │      notifications.sendPaymentFailed()                     │    │
│   └────────────────────────────────────────────────────────────┘    │
│                                                                     │
│ 8. httpStatusFor(outcome)  →  res.status(...).json({ kind })       │
└─────────────────────────────────────────────────────────────────────┘
```

## Why "always 200" except 2 cases

Webhook providers retry on non-2xx. Returning 500 for parse errors or unknown payments would create infinite retry loops. We always 200 EXCEPT:

| Case | Status | Why |
|---|---|---|
| Invalid signature | **401** | Tells ops "auth is broken"; no infinite retry because FW only retries on 5xx |
| Mint failed after CONFIRMED | **500** | Recoverable — we want FW to retry so we can retry the mint |

Everything else (duplicates, parse errors, unknown payments, amount mismatches, already-terminal) returns 200 because retrying won't help.

## Defense in depth — three independent guards against double-credit

1. **Idempotency by eventId**: same Flutterwave event redelivered → SETNX returns false → skip
2. **State machine**: `transitionStatus` only accepts PENDING → terminal; second run returns `already_terminal`
3. **Amount validation**: FW says ₦100 but we initiated ₦5000 → mark FAILED, do not credit

If any one of these is bypassed (e.g. Redis blip → idempotency fails open), the others still hold.

## Critical: Mark's IPaymentProvider

The full payment provider abstraction (initiation, payouts, KYC, refunds) is Mark's module. This file defines the **subset** the webhook handler needs:

```typescript
interface IPaymentProvider {
  readonly name: string;
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  parseEvent(rawBody: Buffer): PaymentEvent | null;
}
```

When Mark's full module lands, this file should re-export from there. The `PaymentEvent` shape is the agreement.

## Mint failure recovery

When `ReconnectService.handlePaymentConfirmed()` throws (HAL/repo down), we've already marked the payment CONFIRMED but the GRD wasn't credited. The handler returns `mint_failed` → HTTP 500 → FW retries.

**Caveat**: idempotency already marked the eventId. On retry FW sends the same eventId, idempotency returns false, we skip. So one of two things must happen:

1. **FW retries with a different eventId** (possible — FW does this for some retry classes)
2. **Manual reconciliation** — see the `payments` table where `status=CONFIRMED` but `energy_balances.last_updated < confirmed_at`

This trade-off (idempotency-first vs reconciliation-flow) is documented in the handler. A future improvement is to NOT mark idempotency until after the mint completes; that's a one-line change but requires considering ordering between FW retries and a slow-running mint.

## Test coverage

70 tests covering:
- Signature verification (timing-safe, missing, wrong, length-aware)
- Parsing (valid, invalid JSON, non-charge events, pending, schema violations)
- Idempotency (first, duplicate, store throws → fail-open)
- Unknown payment (missing tx_ref → 200, no side effects)
- Amount + currency validation (FAILED transitions for fraud/wrong-currency cases)
- Successful flow (mint + reconnect + dual notifications, first top-up vs ongoing)
- Failed flow (FAILED transition + payment-failed notification)
- State machine guards (second confirm with different eventId → already_terminal)
- HTTP status mapping (every outcome kind tested)
- Mint failure path → 500 (FW will retry)
- Full Express integration via supertest (8 round-trip scenarios)
