# gridee-backend

The core API server for **Gridee** — a solar energy tokenisation platform that lets landlords distribute prepaid energy access to tenants via Web3, WhatsApp, and USSD.

This service handles authentication, payment processing, token minting orchestration, the Hardware Abstraction Layer (HAL), the simulated consumption engine, and all notification routing.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express |
| Database | PostgreSQL (via `node-postgres`) |
| Cache / Session | Redis (`ioredis`) |
| Validation | Zod |
| Payments | Flutterwave |
| SMS / USSD | Africa's Talking |
| Messaging | WhatsApp Cloud API |
| Blockchain | ethers.js (Sepolia testnet) |
| Logging | Pino + pino-http |
| Scheduling | node-cron |

---

## Prerequisites

- Node.js v18+
- Docker & Docker Compose (for local Postgres + Redis)
- A Flutterwave account with a secret key and webhook hash
- An Africa's Talking sandbox account (API key + username)
- A WhatsApp Cloud API token and phone number ID
- Access to a Sepolia RPC endpoint (e.g. Alchemy or Infura)
- Deployed contract addresses for `GrideeToken`, `PropertyRegistry`, `EnergyLedger`, `RevenueDistributor`, and `WalletFactory`

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/your-org/gridee-backend.git
cd gridee-backend
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Fill in every value in `.env` — see the [Environment Variables](#environment-variables) section below for what each key does.

### 3. Start local services

```bash
docker-compose up -d
```

This spins up PostgreSQL on port `5432` and Redis on port `6379`.

### 4. Run database migrations

```bash
npx ts-node src/db/migrate.ts
```

### 5. Start the development server

```bash
npm run dev
```

The server starts on `http://localhost:3000` by default.

### 6. Verify the setup

```bash
curl http://localhost:3000/api/health
```

You should receive a JSON response with the status of the DB, Redis, and RPC node connections.

---

## Project Structure

```
gridee-backend/
├── src/
│   ├── routes/           # Express route definitions
│   ├── controllers/      # Request handlers
│   ├── services/
│   │   ├── paymentService.ts       # Flutterwave integration
│   │   ├── contractService.ts      # ethers.js — on-chain calls
│   │   ├── otpService.ts           # OTP generation, storage, verification
│   │   ├── smsService.ts           # Africa's Talking SMS
│   │   ├── notificationService.ts  # Unified WhatsApp / SMS router
│   │   └── transferService.ts      # Flutterwave payout / withdrawal
│   ├── hal/
│   │   └── index.ts      # Hardware Abstraction Layer
│   ├── jobs/
│   │   └── consumptionEngine.ts    # Hourly cron — deduct, alert, cut off
│   ├── middleware/
│   │   └── auth.ts       # JWT validation middleware
│   ├── schemas/          # Zod validation schemas
│   ├── templates/        # WhatsApp / SMS message templates
│   ├── models/           # TypeScript types for DB rows
│   ├── db.ts             # PostgreSQL connection pool
│   ├── redis.ts          # Redis client
│   └── app.ts            # Express app setup
├── docker-compose.yml
├── .env.example
├── tsconfig.json
└── package.json
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret used to sign and verify JWTs |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave secret key for payment API calls |
| `FLUTTERWAVE_WEBHOOK_HASH` | Hash used to verify incoming Flutterwave webhooks |
| `AFRICAS_TALKING_API_KEY` | Africa's Talking API key |
| `AFRICAS_TALKING_USERNAME` | Africa's Talking username (use `sandbox` for dev) |
| `WHATSAPP_API_TOKEN` | WhatsApp Cloud API bearer token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API phone number ID |
| `CONTRACT_RPC_URL` | Sepolia RPC endpoint URL |
| `GRIDEE_TOKEN_ADDRESS` | Deployed address of `GrideeToken.sol` |
| `PROPERTY_REGISTRY_ADDRESS` | Deployed address of `PropertyRegistry.sol` |
| `ENERGY_LEDGER_ADDRESS` | Deployed address of `EnergyLedger.sol` |
| `REVENUE_DISTRIBUTOR_ADDRESS` | Deployed address of `RevenueDistributor.sol` |
| `WALLET_FACTORY_ADDRESS` | Deployed address of `WalletFactory.sol` |
| `PLATFORM_WALLET_ADDRESS` | Platform's own wallet for receiving platform share |
| `OPERATOR_PRIVATE_KEY` | Private key of the wallet with `OPERATOR_ROLE` on-chain |
| `GRD_PRICE_PER_NGN` | Exchange rate: how many GRD tokens per 1 NGN (MVP fixed rate) |
| `CONSUMPTION_KWH_PER_HOUR` | kWh deducted per tenant per cron tick (default: `0.5`) |
| `IS_DEV` | Set to `true` to enable dev-only endpoints like `/api/hal/mock-consume` |

---

## API Overview

### Auth

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/landlord/register` | Begin landlord registration — sends OTP |
| POST | `/api/auth/tenant/register` | Begin tenant registration with property code — sends OTP |
| POST | `/api/auth/verify` | Verify OTP, create user, assign wallet, return JWT |

### Properties

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/properties` | Register a new property (landlord, auth required) |

### Payments

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/payments/initiate` | Initiate token purchase — returns payment instructions |
| POST | `/api/payments/webhook` | Flutterwave webhook receiver — mints tokens on success |

### Landlord

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/landlord/properties` | List all properties for authenticated landlord |
| GET | `/api/landlord/properties/:code` | Single property detail |
| GET | `/api/landlord/properties/:code/tenants` | Tenant list for a property |
| GET | `/api/landlord/earnings` | Total earnings + per-property breakdown |
| GET | `/api/landlord/earnings/:code` | Earnings for a single property |
| POST | `/api/landlord/withdraw` | Initiate payout via Flutterwave |
| POST | `/api/landlord/properties/:code/remove-tenant` | Disconnect a tenant |

### Tenant

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tenants/balance` | On-chain GRD balance + NGN equivalent + hours remaining |
| GET | `/api/tenants/history` | Last 10 transactions |
| GET | `/api/tenants/property` | Property the tenant is registered under |

### System

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | DB, Redis, and RPC connectivity check |
| POST | `/api/hal/mock-consume` | Dev only (`IS_DEV=true`) — manually trigger consumption |

---

## Database Schema

```sql
users         — id, name, phone, role, wallet_address, created_at
properties    — id, landlord_id, code, label, address, state, flat_count, status, created_at
tenants       — id, user_id, property_id, status, created_at
transactions  — id, tenant_id, amount_ngn, grd_amount, payment_method, payment_ref, status, created_at
notifications — id, user_id, channel, message, status, created_at
meters        — id, tenant_id, device_id, registered_at
```

Property codes follow the format: `GRD-{STATE}-{sequence padded to 4 digits}` — e.g. `GRD-LAG-0042`.

---

## Consumption Engine

A cron job runs every hour and processes all active tenants:

1. Deducts `CONSUMPTION_KWH_PER_HOUR` from each tenant's on-chain balance via the HAL
2. If balance drops below **1 GRD** → sends a low-balance alert (WhatsApp + SMS)
3. If balance reaches **0** → cuts off the tenant and sends a cutoff notice
4. On next top-up where previous balance was 0 → automatically reconnects and sends a restored notice

---

## Payment Flow

1. Tenant calls `POST /api/payments/initiate` with an NGN amount
2. Backend calculates GRD equivalent using `GRD_PRICE_PER_NGN` and calls Flutterwave to create a virtual bank account (or mobile money charge)
3. Payment instructions are returned to the caller (bot/USSD sends them to the tenant)
4. Flutterwave fires `POST /api/payments/webhook` on success
5. Backend verifies the webhook hash, looks up the transaction, mints GRD on-chain, updates DB, and sends a confirmation notification

Webhook idempotency is enforced via Redis (`webhook:{txRef}`, 24-hour TTL) to safely handle Flutterwave retries.

---

## Running Tests

```bash
npm test
```

Template unit tests live in `src/templates/templates.test.ts`. Integration tests should be run against a local Docker environment with `IS_DEV=true`.

---

## Health Check

```bash
curl http://localhost:3000/api/health
```

Returns:

```json
{
  "db": "ok",
  "redis": "ok",
  "rpc": "ok"
}
```

Used by UptimeRobot in production for uptime monitoring.

---

## Deployment

The backend is deployed to **Railway** (or Render). Set all environment variables via the hosting dashboard, point the Flutterwave webhook URL to the live server, and confirm the production health check returns `200` after deploy.

Contract addresses used in production target **Sepolia testnet** for the MVP. See `gridee-contracts/deployments/sepolia.json` for the full list.

---

> *Gridee · Web3Bridge Capstone 2026*
> *"Power the home. Own the future."*