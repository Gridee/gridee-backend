# gridee-backend Contract for gridee-bot

When `BACKEND_MODE=http`, the bot calls these internal endpoints.

All requests include:

```http
Authorization: Bearer <GRIDEE_BACKEND_API_KEY>
Content-Type: application/json
```

## Users and OTP

### POST `/bot/users/resolve`
Request:
```json
{ "phone": "+2348031234567" }
```
Response:
```json
{ "user": null }
```
or
```json
{ "user": { "id": "uuid", "phone": "+2348031234567", "name": "Bisi", "role": "tenant" } }
```

### PATCH `/bot/users/role`
```json
{ "phone": "+2348031234567", "role": "tenant" }
```

### POST `/bot/otp/send`
```json
{ "phone": "+2348031234567", "purpose": "registration" }
```

### POST `/bot/otp/verify`
```json
{ "phone": "+2348031234567", "code": "123456", "purpose": "registration" }
```

## Landlord

### POST `/bot/landlords/register`
```json
{ "phone": "+2348031234567", "name": "Emeka Okafor", "verificationPhone": "+2348031234567" }
```

### POST `/bot/properties`
```json
{ "landlordPhone": "+2348031234567", "address": "No 5...", "flatCount": 8, "label": "Surulere Block A" }
```

### GET `/bot/landlords/:phone/properties`

### GET `/bot/landlords/:phone/earnings`

### POST `/bot/landlords/:phone/withdrawals`
```json
{ "channel": "bank", "amount": 10000 }
```

## Tenant

### GET `/bot/properties/:code/validate`

### POST `/bot/tenants/register`
```json
{ "phone": "+2348031234567", "name": "Bisi", "verificationPhone": "+2348031234567", "propertyCode": "GRD-LAG-0001" }
```

### POST `/bot/payments/intents`
```json
{ "tenantPhone": "+2348031234567", "amountNaira": 2000, "paymentMethod": "bank_transfer" }
```

### GET `/bot/tenants/:phone/balance`
### GET `/bot/tenants/:phone/history`
### GET `/bot/tenants/:phone/property`
