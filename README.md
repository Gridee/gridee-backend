# gridee-bot

Standalone WhatsApp bot service for Gridee.

This service owns only the conversation layer:

- WhatsApp webhook verification and inbound message parsing
- Provider adapters for Twilio Sandbox and Meta WhatsApp Cloud API
- Session state using `SCREENS.md` screen IDs
- Command routing and flow orchestration
- Calling `gridee-backend` internal APIs
- Rendering WhatsApp-safe templates

It does **not** own Gridee business data, token minting, payments, or contracts. Those live in `gridee-backend` and `gridee-contracts`.

## Why this structure

The uploaded `SCREENS.md` says every Redis `step`, notification send call, and bot/USSD screen must use defined screen IDs only. This implementation follows that rule through `src/core/screen-id.js`, `src/templates/index.js`, and the flow files.

## Quick start with Twilio Sandbox

```bash
cp .env.example .env
# Fill TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN if using TWILIO_REPLY_MODE=api.
# For sandbox-only replies, TWILIO_REPLY_MODE=twiml works without calling the send API.

npm install
npm run dev
```

Expose locally:

```bash
ngrok http 4100
```

Set Twilio Sandbox "When a message comes in" to:

```text
https://d244-102-89-84-157.ngrok-free.app/webhooks/whatsapp
```

Method: `POST`.

Send `join <sandbox-code>` to the Twilio WhatsApp number, then test:

```text
Hi
```

## Environment modes

### Mock mode

```env
BACKEND_MODE=mock
```

Useful while `gridee-backend` is still being built. It uses an in-memory backend fake.

### HTTP mode

```env
BACKEND_MODE=http
GRIDEE_BACKEND_BASE_URL=http://localhost:4000/internal
GRIDEE_BACKEND_API_KEY=dev-secret-key
```

In this mode, the bot calls `gridee-backend` internal endpoints.

## Useful test flow

Landlord:

```text
Hi
1
John Landlord
08031234567
123456
ADD PROPERTY
No 5 Balogun Street, Yaba, Lagos
8
Surulere Block A
MY PROPERTIES
EARNINGS
```

Tenant:

```text
Hi
2
Bisi Tenant
08087654321
123456
GRD-LAG-0001
BUY 2000
1
BALANCE
```

Mock OTP is `123456` by default.

## Run tests

```bash
npm test
```

The tests check:

- screen IDs are unique
- required user-facing screens have templates
- command parsing
- key bot flows against the mock backend
