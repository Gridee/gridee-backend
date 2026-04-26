# Contributing to gridee-backend

This guide covers everything specific to contributing to the `gridee-backend` service. Please read it before opening a PR.

---

## Table of Contents

- [Local Setup](#local-setup)
- [Folder Ownership](#folder-ownership)
- [Branching Strategy](#branching-strategy)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Code Conventions](#code-conventions)
- [Adding a New API Endpoint](#adding-a-new-api-endpoint)
- [Working with the Database](#working-with-the-database)
- [Working with Smart Contracts](#working-with-smart-contracts)
- [Working with the Notification Service](#working-with-the-notification-service)
- [Writing Message Templates](#writing-message-templates)
- [Testing](#testing)
- [Do's and Don'ts](#dos-and-donts)

---

## Local Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/your-org/gridee-backend.git
   cd gridee-backend
   npm install
   ```

2. Copy the environment template and fill in your values:
   ```bash
   cp .env.example .env
   ```

3. Start PostgreSQL and Redis locally via Docker:
   ```bash
   docker-compose up -d
   ```

4. Run the database migrations:
   ```bash
   npx ts-node src/db/migrate.ts
   ```

5. Start the dev server:
   ```bash
   npm run dev
   ```

6. Confirm everything is working:
   ```bash
   curl http://localhost:3000/api/health
   ```
   All three fields (`db`, `redis`, `rpc`) should return `"ok"`.

> Set `IS_DEV=true` in your `.env` to enable the `POST /api/hal/mock-consume` endpoint, which lets you trigger consumption manually without waiting for the hourly cron.

---

## Folder Ownership

To avoid merge conflicts, each area of the codebase has a primary owner. Before touching a folder outside your area, coordinate with its owner first.

| Folder / File | Primary Owner |
|---|---|
| `src/routes/` + `src/controllers/` | Backend APIs |
| `src/services/paymentService.ts` | Payments |
| `src/services/contractService.ts` | Blockchain / contracts |
| `src/services/otpService.ts` + `src/services/smsService.ts` | SMS / OTP |
| `src/services/notificationService.ts` | Notifications |
| `src/hal/` | HAL + cron |
| `src/jobs/consumptionEngine.ts` | HAL + cron |
| `src/templates/` | Templates |
| `src/schemas/` | Whoever adds the new endpoint |
| `src/db.ts` + `src/redis.ts` + migrations | DB |

If your task requires editing a file outside your area, create a PR and request the owner's review specifically.

---

## Branching Strategy

All development branches off `develop`. Never commit directly to `main` or `develop`.

| Branch prefix | Use for |
|---|---|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `docs/` | Documentation changes only |
| `chore/` | Tooling, dependency updates, config |

```bash
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name
```

---

## Commit Message Guidelines

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(scope): short description
```

Common types for this repo:

| Type | Use when |
|---|---|
| `feat` | New endpoint, service, or feature |
| `fix` | Bug fix |
| `docs` | README, CONTRIBUTING, inline comments |
| `chore` | Dependency updates, config, tooling |
| `test` | Adding or updating tests |
| `refactor` | Code restructuring with no behaviour change |

**Scopes** to use: `auth`, `payments`, `contracts`, `hal`, `notifications`, `templates`, `ussd`, `bot`, `db`, `otp`, `sms`, `cron`

Examples:
```
feat(auth): add OTP rate limiting after 3 failed attempts
fix(payments): handle null tx_ref in Flutterwave webhook
feat(hal): add mock-consume dev endpoint
chore(deps): upgrade ethers to v6
test(templates): add assertions for paymentExpired template
```

Keep the subject line under 72 characters. Reference related issues in the footer: `Closes #12`.

---

## Pull Request Process

1. Push your branch:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a PR against `develop` (not `main`).

3. Fill in the PR description: what changed, why, and how to test it locally.

4. Ensure:
   - All existing tests pass: `npm test`
   - No TypeScript errors: `npx tsc --noEmit`
   - The health check endpoint still returns `200`
   - If you added a new env variable, it is in `.env.example` with a comment explaining it

5. Request a review. Do not merge your own PR.

6. Squash and merge once approved.

---

## Code Conventions

- **TypeScript everywhere** — no plain `.js` files in `src/`
- **Zod for all request validation** — write schemas in `src/schemas/` and apply them in controllers, not routes
- **Consistent error response shape** — every error must use this format:
  ```json
  { "success": false, "error": { "code": "SNAKE_CASE_CODE", "message": "Human-readable message." } }
  ```
- **No `any`** — use proper types or `unknown` with a type guard
- **No raw SQL strings in controllers** — DB queries belong in `src/models/` or dedicated service functions
- **Async/await only** — no `.then()` chains
- **Logging** — use `pino` for structured logs. Never log raw OTPs, private keys, or full JWTs.

---

## Adding a New API Endpoint

Follow this pattern for every new endpoint:

1. **Schema** — add a Zod schema in `src/schemas/`
2. **Service** — add business logic to the appropriate file in `src/services/`
3. **Controller** — add the handler in `src/controllers/`, validate with the schema, call the service, return a typed response
4. **Route** — register the route in `src/routes/`, apply `authMiddleware` if the endpoint is protected
5. **Docs** — add the endpoint to the API table in `README.md`

Auth-gated endpoints must pass through `src/middleware/auth.ts`. No exceptions.

---

## Working with the Database

- All schema changes go through migration files — do not alter tables manually
- Migration files live in `src/db/migrations/` and are numbered sequentially
- Run migrations with: `npx ts-node src/db/migrate.ts`
- Table names are **snake_case** and plural: `users`, `transactions`, `notifications`
- Column names are **snake_case**: `wallet_address`, `created_at`
- Never delete a column in a migration — mark it unused and coordinate a cleanup migration separately

Property code format: `GRD-{STATE}-{4-digit sequence}` — e.g. `GRD-ABJ-0001`. Generation logic lives in the property registration service.

---

## Working with Smart Contracts

All on-chain interactions go through `src/services/contractService.ts`. Do not call `ethers.js` directly from controllers or other services.

Functions exposed by `contractService`:

```typescript
mintTokens(address: string, amount: number): Promise<void>
registerProperty(code: string, flatCount: number): Promise<void>
assignWallet(userId: number, address: string): Promise<void>
getBalance(address: string): Promise<number>
deductTokens(address: string, amount: number): Promise<void>
```

The backend's operator wallet (identified by `OPERATOR_PRIVATE_KEY`) must hold `OPERATOR_ROLE` on both `GrideeToken` and `EnergyLedger` on-chain. If a contract call reverts with an access control error, check this first.

Deployed Sepolia contract addresses are documented in `gridee-contracts/deployments/sepolia.json`.

---

## Working with the Notification Service

All outbound notifications go through `src/services/notificationService.ts`. Do not call `smsService` or the WhatsApp sender directly from controllers or the cron engine.

```typescript
send(phone: string, message: string, channel: 'whatsapp' | 'sms' | 'both'): Promise<void>
```

If the WhatsApp API returns a non-200, the service automatically falls back to SMS and logs the fallback. Every notification attempt is recorded in the `notifications` table with a status of `SENT`, `FAILED`, or `FALLBACK_SMS`.

Events that must fire a notification — do not skip any:

| Event | Recipient | Channel |
|---|---|---|
| OTP sent | Any user | SMS |
| Registration success | New user | WhatsApp |
| New tenant joined property | Landlord | WhatsApp |
| Payment instructions issued | Tenant | WhatsApp + SMS (USSD users) |
| Payment confirmed / tokens minted | Tenant | Both |
| Payment failed | Tenant | WhatsApp |
| Low balance (< 1 GRD) | Tenant | Both |
| Cut-off executed | Tenant | Both |
| Power restored | Tenant | Both |
| Withdrawal initiated | Landlord | WhatsApp |
| Withdrawal confirmed | Landlord | WhatsApp |
| Tenant removed | Landlord + Tenant | WhatsApp |

---

## Writing Message Templates

Templates live in `src/templates/` and are plain TypeScript functions that return strings. No side effects, no async, no external calls.

Rules:
- Messages must feel warm and conversational — not like a banking robot
- Use `*asterisks*` for bold text in WhatsApp messages
- Use `\n` for line breaks
- Keep SMS templates under 160 characters where possible
- Always run output through `safeMessage()` before passing to `notificationService.send()` — this truncates at the WhatsApp 4,096-character limit
- Write a unit test in `src/templates/templates.test.ts` for every new template

Example:
```typescript
export function lowBalanceAlert(balance: number, kwhLeft: number): string {
  return `⚠️ *Low Energy Alert!* Your balance is below 1 kWh (${balance} GRD left).\n\nType *BUY [amount]* to top up now and keep your power on.`
}
```

All screen IDs used across the bot, USSD, and backend are documented in `SCREENS.md` at the root of this repo. Keep it updated when you add new flows.

---

## Testing

Run all tests:
```bash
npm test
```

Check for TypeScript errors:
```bash
npx tsc --noEmit
```

To fast-forward the consumption cycle in development:
```bash
curl -X POST http://localhost:3000/api/hal/mock-consume \
  -H "Content-Type: application/json" \
  -d '{ "tenantId": 1, "kwhAmount": 5 }'
```

Requires `IS_DEV=true` in your `.env`.

To test webhook signature verification: send a request with a correct `verif-hash` to confirm it processes, then send one with a wrong hash and confirm it returns `401`.

---

## Do's and Don'ts

**Do:**
- ✅ Check the folder ownership table before touching someone else's file
- ✅ Add new env variables to `.env.example` with a comment
- ✅ Run `npm test` and `npx tsc --noEmit` before pushing
- ✅ Log every consumption cycle result — tenants processed, alerts sent, cut-offs executed
- ✅ Record every outbound notification in the `notifications` table
- ✅ Use `IS_DEV` guards on anything that must not run in production

**Don't:**
- ❌ Push directly to `main` or `develop`
- ❌ Call `ethers.js` outside of `contractService.ts`
- ❌ Call WhatsApp or SMS APIs outside of `notificationService.ts`
- ❌ Log OTPs, private keys, or raw JWT payloads
- ❌ Skip Zod validation on any endpoint that accepts a request body
- ❌ Add an env variable without documenting it in `.env.example` and `README.md`
- ❌ Merge your own pull request

---

> *Gridee · Web3Bridge Capstone 2026*