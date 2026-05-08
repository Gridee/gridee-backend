# Gridee v2.0 API Documentation (Bot Handover)

Base URL: `http://localhost:8000` (Default)
Authentication: All `/bot/*` routes require the `x-bot-secret` header.

---

## 1. User Resolution & Registration

### Resolve User
Checks if a user exists in the database.
- **Endpoint**: `POST /bot/users/resolve`
- **Body**: `{ "phone": "23480..." }`
- **Response**: `{ "user": { ... } | null }`

### Register Tenant
Registers a tenant, provisions an embedded Privy wallet, and links them to a property on-chain.
- **Endpoint**: `POST /bot/tenants/register`
- **Body**: `{ "phone": "WhatsAppPhone", "name": "Name", "propertyCode": "CODE" }`
- **Response**: `{ "success": true, "token": "JWT", "tenant": { "wallet_address": "0x..." } }`

### Register Landlord
Registers a landlord and provisions an embedded Privy wallet.
- **Endpoint**: `POST /bot/landlords/register`
- **Body**: `{ "phone": "WhatsAppPhone", "name": "Name" }`
- **Response**: `{ "success": true, "token": "JWT", "user": { "wallet_address": "0x..." } }`

---

## 2. Financial Flow (USDC)

### Fund Wallet (Instructions)
Provides the wallet address for the user to send USDC to.
- **Endpoint**: `POST /bot/tenants/:phone/fund`
- **Response**: `{ "walletAddress": "0x...", "message": "..." }`

### Deposit USDC to Platform
Moves USDC from the user's wallet into the Gridee contract "locked" balance. This is required before buying tokens.
- **Endpoint**: `POST /bot/tenants/:phone/deposit`
- **Body**: `{ "usdcAmount": 10.5 }`
- **Response**: `{ "success": true, "txHash": "0x..." }`

### Buy Tokens
Purchases electricity tokens (GRD) using the locked USDC balance. 
Funds are split on-chain: Landlord (80%), Platform (10%), Ops (10%) - *Shares configurable*.
- **Endpoint**: `POST /bot/tenants/:phone/buy`
- **Body**: `{ "usdcAmount": 5.0 }`
- **Response**: `{ "success": true, "txHash": "0x..." }`

---

## 3. Dashboard Data

### Get Tenant Balance
- **Endpoint**: `GET /bot/tenants/:phone/balance`
- **Response**:
```json
{
  "balanceGrd": 150.5,
  "lockedUsdc": 5.25,
  "estimatedHours": 301,
  "propertyName": "Allen Compound",
  "status": "Connected"
}
```

### Get Landlord Earnings
- **Endpoint**: `GET /bot/landlords/:phone/earnings`
- **Response**: `{ "total": 1250.0, "breakdown": [{ "code": "...", "amount": 500.0 }] }`

---

## 4. Platform & Ops

### Get Platform Stats
View the health of the platform and ops wallets as defined in the contract.
- **Endpoint**: `GET /bot/platform/stats`
- **Response**:
```json
{
  "platformBalance": "5000.50",
  "opsBalance": "1200.75",
  "totalGrdSupply": "100000.0"
}
```

---

## 5. Session Management
Used by the bot to persist state across WhatsApp messages.
- `GET /bot/sessions/:phone`
- `POST /bot/sessions/:phone` - Body: `{ "data": { ... } }`
- `DELETE /bot/sessions/:phone`

---

## Contract Requirements (Handover Note)
- **Operator Private Key**: The backend uses an `OPERATOR_PRIVATE_KEY` for on-chain actions (Property registration, Tenant registration, Consumption deduction).
- **Permissions**: This key MUST have the `OPERATOR_ROLE` on all 3 contracts (`PropertyRegistry`, `EnergyLedger`, `GrideeToken`).
- **Network**: Deployed on Lisk Sepolia.
