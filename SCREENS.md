# SCREENS.md — Gridee Screen ID Reference

> **Ownership:** Mark David (templates) · Izzy (WhatsApp bot flows) · Nifemi (USSD flows) · Ag.baby (bot commands)
>
> **Purpose:** Single source of truth for every screen ID used across the bot, USSD, and
> template modules. Every session `step` value in Redis, every `notificationService.send()`
> call, and every USSD menu screen must use the IDs defined here — no ad-hoc strings in code.
>
> **Format:** `SCREEN_ID` → prompt shown to the user, or description of what happens

---

## Registration & Onboarding

### Shared

| Screen ID             | User-facing prompt / description                             |
| --------------------- | ------------------------------------------------------------ |
| `WELCOME_ROLE_SELECT` | "Welcome to Gridee ⚡ Are you a (1) Landlord or (2) Tenant?" |

### Landlord Registration

| Screen ID                | User-facing prompt / description                                 |
| ------------------------ | ---------------------------------------------------------------- |
| `LANDLORD_REG_NAME`      | "What is your full name?"                                        |
| `LANDLORD_REG_PHONE`     | "Enter your phone number for verification."                      |
| `LANDLORD_REG_OTP`       | "Enter the 6-digit OTP sent to your number."                     |
| `LANDLORD_AUTHENTICATED` | _(internal state — triggers `welcomeMessage(name, 'landlord')`)_ |

### Tenant Registration

| Screen ID              | User-facing prompt / description                                     |
| ---------------------- | -------------------------------------------------------------------- |
| `TENANT_REG_NAME`      | "What is your full name?"                                            |
| `TENANT_REG_PHONE`     | "Enter your phone number for verification."                          |
| `TENANT_REG_OTP`       | "Enter the OTP sent to your number."                                 |
| `TENANT_REG_PROP_CODE` | "Enter the Property Code your landlord gave you (e.g. GRD-LAG-0042)" |
| `TENANT_AUTHENTICATED` | _(internal state — triggers `welcomeMessage(name, 'tenant')`)_       |

---

## Help

| Screen ID       | User-facing prompt / description                          |
| --------------- | --------------------------------------------------------- |
| `HELP_LANDLORD` | Full landlord command list — rendered by `helpLandlord()` |
| `HELP_TENANT`   | Full tenant command list — rendered by `helpTenant()`     |

---

## Errors & System

| Screen ID                  | User-facing prompt / description                                                  |
| -------------------------- | --------------------------------------------------------------------------------- |
| `ERROR_GENERIC`            | Unexpected server error — rendered by `errorGeneric()`                            |
| `ERROR_INVALID_OTP`        | "Incorrect OTP. Try again or type RESEND to get a new one."                       |
| `ERROR_OTP_EXPIRED`        | "Your OTP has expired. Type RESEND to get a new one."                             |
| `ERROR_RESEND_OTP`         | "A new OTP has been sent to your number. Valid for 5 minutes."                    |
| `ERROR_ALREADY_REGISTERED` | "You already have an account. Type HELP to see your options."                     |
| `ERROR_INVALID_PROP_CODE`  | "That Property Code wasn't found. Please check with your landlord and try again." |
| `SESSION_EXPIRED`          | Session timeout — rendered by `sessionExpired()`                                  |

---

## Token Purchase (BUY flow)

| Screen ID                           | User-facing prompt / description                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `BUY_AMOUNT`                        | "How much would you like to spend? (in NGN, e.g. BUY 2000)"                                                                 |
| `BUY_CONFIRM`                       | "You're buying X GRD for ₦[amount] — roughly Y kWh. Choose a payment method: (1) Bank Transfer (2) Mobile Money (3) Crypto" |
| `PAYMENT_INSTRUCTIONS_BANK`         | Bank account number, bank name, reference, NGN amount, 15-min expiry notice                                                 |
| `PAYMENT_INSTRUCTIONS_MOBILE_MONEY` | Mobile money network, reference, NGN amount                                                                                 |
| `PAYMENT_INSTRUCTIONS_CRYPTO`       | USDT wallet address, USDT equivalent, reference                                                                             |
| `AWAITING_PAYMENT`                  | _(internal state — session paused; waiting for Flutterwave webhook)_                                                        |
| `PAYMENT_CONFIRMED`                 | "✅ Payment confirmed! X GRD added to your account. New balance: Y GRD (≈ Z hours)."                                        |
| `PAYMENT_EXPIRED`                   | "Your payment window expired. Type BUY [amount] to try again."                                                              |
| `PAYMENT_FAILED`                    | "Your payment could not be processed. [reason]. Type BUY [amount] to try again."                                            |

---

## Tenant Commands

| Screen ID          | User-facing prompt / description                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `BALANCE_VIEW`     | "Your Gridee balance: X GRD ≈ Y hours of average usage. Property: [Name]. Last topped up: [date]." |
| `HISTORY_VIEW`     | Last 10 purchase transactions — date, NGN amount, GRD received                                     |
| `MY_PROPERTY_VIEW` | Property label, full address, landlord name, tenant connection status                              |

---

## Landlord Commands

### Property Management

| Screen ID                 | User-facing prompt / description                                              |
| ------------------------- | ----------------------------------------------------------------------------- |
| `MY_PROPERTIES_LIST`      | Numbered list of all the landlord's properties with codes and flat counts     |
| `ADD_PROPERTY_ADDRESS`    | "Enter the property address (street, area, state):"                           |
| `ADD_PROPERTY_FLAT_COUNT` | "How many rentable flats/units are in this compound?"                         |
| `ADD_PROPERTY_LABEL`      | "Give this property a short name (e.g. Surulere Block A):"                    |
| `PROPERTY_REGISTERED`     | "Property registered! Your code is GRD-LAG-0042. Share it with your tenants." |
| `PROPERTY_DETAIL`         | Code, label, address, flat count, active tenant count, solar status           |
| `TENANTS_LIST`            | List of tenant names and connection status under a given property             |

### Earnings & Withdrawal

| Screen ID              | User-facing prompt / description                                                    |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `EARNINGS_OVERVIEW`    | "Total earnings: ₦X across Y properties." + per-property breakdown                  |
| `EARNINGS_PROPERTY`    | Earnings detail for a single property                                               |
| `WITHDRAW_BANK_INPUT`  | "Where should we send your funds? (1) Bank Account (2) OPay (3) PalmPay"            |
| `WITHDRAW_CONFIRM`     | "Withdraw ₦X to [Bank] \*\*\*\*[last 4]? Reply CONFIRM to proceed."                 |
| `WITHDRAWAL_INITIATED` | "₦X is being transferred to [Bank] \*\*\*\*[last 4]. Should arrive within 2 hours." |

### Tenant Management

| Screen ID                 | User-facing prompt / description                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `REMOVE_TENANT_PHONE`     | "Enter the phone number of the tenant you want to remove:"                                |
| `REMOVE_TENANT_CONFIRM`   | "Remove [Name] from [Property]? This stops their solar access. Reply CONFIRM to proceed." |
| `TENANT_REMOVED_LANDLORD` | "Done. [Name] has been removed from [Property] and their solar access has stopped."       |

---

## Push Notifications (system-initiated, not command-triggered)

Sent automatically by `notificationService` — the user does not trigger these with a command.

| Screen ID                     | Trigger                                | Recipient      | User-facing message                                                                                        |
| ----------------------------- | -------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| `ALERT_LOW_BALANCE`           | Tenant balance drops below 1 GRD       | Tenant         | "⚠️ Low Energy Alert! Your balance is below 1 kWh (X GRD left). Type BUY [amount] to top up now."          |
| `ALERT_CUTOFF`                | Tenant balance hits 0                  | Tenant         | "⚡ Your solar access has been paused — your Gridee balance is empty. Type BUY [amount] to restore power." |
| `ALERT_RESTORED`              | Tenant tops up after a cutoff          | Tenant         | "✅ Power restored! Your solar is back on. New balance: X GRD (≈ Y hours)."                                |
| `NOTIFY_NEW_TENANT`           | New tenant registers under a property  | Landlord       | "New tenant [Name] has registered under your property [Code]."                                             |
| `NOTIFY_PURCHASE_CONFIRMED`   | Flutterwave webhook fires successfully | Tenant         | Same as `PAYMENT_CONFIRMED` — triggered by webhook, not by command                                         |
| `NOTIFY_WITHDRAWAL_CONFIRMED` | Payout transfer completes              | Landlord       | "✅ ₦X has been sent to your [Bank] account. Expect it within 2 hours."                                    |
| `NOTIFY_TENANT_REMOVED`       | Landlord removes a tenant              | Evicted tenant | "You have been removed from [Property Name]. Contact your landlord for more information."                  |

---

## Notes for Developers

- **Session `step` values** in Redis must exactly match the Screen IDs above, e.g.:
  ```typescript
  await setSession(phone, {
    step: "LANDLORD_REG_OTP",
    role: "landlord",
    data: {},
  });
  ```
- **Internal state screens** (marked _internal state_) do not emit a message themselves.
  They signal to the dispatcher to call the corresponding template function.
- **WhatsApp character limit:** 4,096 chars max. All template functions in
  `src/templates/index.ts` are tested against this limit.
- **USSD character limit:** 182 chars per response. USSD screen text lives in
  `gridee-ussd` — not in this templates module.
- **Naming convention:** `NOUN_VERB` or `NOUN_STATE` — all caps, underscores only.
  Do not use camelCase or hyphens.

---

### OTP & Verification

| Screen ID     | Template function  | User-facing prompt / description                                                         |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `OTP_SENT`    | `otpMessage(code)` | "Your Gridee verification code is: [code]. Valid for 5 minutes. Do not share this code." |
| `OTP_INVALID` | `invalidOTP()`     | "Incorrect code. That OTP doesn't match what we sent. Type RESEND for a new one."        |
| `OTP_RESENT`  | `resendOTP()`      | "A new verification code has been sent to your number. Valid for 5 minutes."             |

### Registration Flow

| Screen ID              | Template function                 | User-facing prompt / description                                               |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------ |
| `ROLE_PROMPT`          | `rolePrompt()`                    | First message to any new user — asks them to choose (1) Landlord or (2) Tenant |
| `REGISTRATION_SUCCESS` | `registrationSuccess(name, role)` | Short confirmation that account was created, with a role-specific next step    |
| `ALREADY_REGISTERED`   | `alreadyRegistered()`             | Shown when a phone number that already has an account tries to register again  |

### Property Registration

| Screen ID             | Template function                 | User-facing prompt / description                                        |
| --------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `PROPERTY_REGISTERED` | `propertyRegistered(code, label)` | "Property registered! Your code is [code]. Share it with your tenants." |

---

### Payment Instructions

| Screen ID                           | Template function                                                                                       | User-facing prompt / description                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PAYMENT_INSTRUCTIONS_BANK`         | `paymentInstructionsBankTransfer(accountNumber, bankName, reference, amountNGN, expiryMins, grdAmount)` | Shows virtual account number, bank, reference, NGN amount, GRD to receive, and expiry countdown |
| `PAYMENT_INSTRUCTIONS_MOBILE_MONEY` | `paymentInstructionsMobileMoney(network, reference, amountNGN)`                                         | Shows mobile money network, reference, and NGN amount to send                                   |
| `PAYMENT_INSTRUCTIONS_CRYPTO`       | `paymentInstructionsCrypto(walletAddress, amountUSDT, reference)`                                       | Shows USDT wallet address, USDT amount, and reference/memo                                      |

### Payment Outcomes

| Screen ID           | Template function                                        | User-facing prompt / description                                                                    |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `PAYMENT_CONFIRMED` | `paymentConfirmed(grdAmount, newBalance, kwhEquivalent)` | "Payment confirmed! +X GRD added. New balance: Y GRD (≈ Z kWh)." — triggered by Flutterwave webhook |
| `PAYMENT_EXPIRED`   | `paymentExpired()`                                       | Payment window closed with no transfer received. Reassures user, prompts retry.                     |
| `PAYMENT_FAILED`    | `paymentFailed(reason)`                                  | Payment provider returned a failure. Shows reason, reassures no deduction, prompts retry.           |

### SMS / USSD

| Screen ID                   | Template function                                | Channel  | User-facing message                                                            |
| --------------------------- | ------------------------------------------------ | -------- | ------------------------------------------------------------------------------ |
| `PURCHASE_SMS_CONFIRMATION` | `purchaseSMSConfirmation(grdAmount, newBalance)` | SMS only | Plain-text confirmation under 160 chars. No WhatsApp markdown. For USSD users. |

> **Note:** `PURCHASE_SMS_CONFIRMATION` is the only template with a 160-char SMS limit constraint. All other templates target WhatsApp (4,096-char limit).

---
