# Notifications (`gridee-backend/src/notifications/`)

Unified outbound dispatch for all system-initiated messages from the backend. Every event in SCREENS.md that the backend originates flows through here.

## Files

| File | Role |
|---|---|
| `INotificationService.ts` | Interface + `NotificationResult` type (non-throwing return) |
| `NotificationService.ts` | Default impl with WhatsApp → SMS fallback |
| `ISmsProvider.ts` | SMS provider abstraction (separate from messaging IMessageSender) |
| `index.ts` | Public exports |

## Behavior

```
┌──────────────────────────┐
│ Caller (ConsumptionService│
│  / payment webhook /      │
│  ReconnectService)        │
└──────────┬───────────────┘
           │ sendCutoffNotice(phone)
           ▼
┌──────────────────────────────┐
│ NotificationService          │
│   1. Compose copy            │
│   2. Try WhatsApp            │  ─► success: { delivered, channelUsed: 'whatsapp' }
│   3. WhatsApp failed?        │
│      Try SMS                 │  ─► success: { delivered, channelUsed: 'sms' }
│      Both failed?            │  ─► { delivered: false, channelUsed: null, error: ... }
│   4. NEVER throws            │
└──────────────────────────────┘
```

## SCREENS.md events covered

| Method | Screen ID | Recipient |
|---|---|---|
| `sendLowBalanceAlert` | `ALERT_LOW_BALANCE` | Tenant |
| `sendCutoffNotice` | `ALERT_CUTOFF` | Tenant |
| `sendRestoredNotice` | `ALERT_RESTORED` | Tenant |
| `sendPurchaseConfirmed` | `NOTIFY_PURCHASE_CONFIRMED` | Tenant |
| `sendPaymentFailed` | `PAYMENT_FAILED` | Tenant |
| `sendNewTenantAlert` | `NOTIFY_NEW_TENANT` | Landlord |
| `sendWithdrawalInitiated` | `WITHDRAWAL_INITIATED` | Landlord |
| `sendWithdrawalConfirmed` | `NOTIFY_WITHDRAWAL_CONFIRMED` | Landlord |
| `sendTenantRemoved` | `TENANT_REMOVED_LANDLORD` + `TENANT_REMOVED_EVICTED` | **Both** (parallel dispatch) |

## Why non-throwing

The orchestrators (ConsumptionService, ReconnectService) need to make decisions based on whether the user got the message:
- "Cutoff was applied even though notification failed" — log, but don't undo the relay flip
- "Reconnect failed but mint succeeded" — log, retry path will fix it next tick

Throwing would make every caller wrap in try/catch, drown logs in stack traces, and risk callers forgetting and crashing on a transient SMS API blip. Returning `NotificationResult` keeps control flow linear.

## Future enhancement

Persist every attempt to a `notifications` table with `(phone, screen_id, channel, status, error, sent_at)`. Already factored in:
- The dispatch path is one funnel function
- All info is already structured (channelUsed, error, screenId)
- Just add a repository call before returning

## Integration with templates

Today: copy is composed inline in this module. Mark's `templates/` module (when it lands) will own the copy; this module imports from there.
