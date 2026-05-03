import { z } from 'zod';
import type { Phone } from '../lib/phone';
import type { TenantId } from '../hal';

// ─────────────────────────────────────────────────────────────────────────────
// Branded types
// ─────────────────────────────────────────────────────────────────────────────

declare const paymentIdBrand: unique symbol;
export type PaymentId = string & { readonly [paymentIdBrand]: true };

const PaymentIdSchema = z.string().min(1).transform((v): PaymentId => v as PaymentId);
export const PaymentId = {
  schema: PaymentIdSchema,
  of(raw: string): PaymentId {
    return PaymentIdSchema.parse(raw);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Status state machine
//
//   PENDING ──── confirmed via webhook ────▶ CONFIRMED  (terminal)
//      │
//      ├── failed via webhook ────────────▶ FAILED      (terminal)
//      │
//      └── 15-min expiry sweeper ─────────▶ EXPIRED     (terminal)
//
// Once terminal, a row never transitions again. Webhook replays for the
// SAME (provider, eventId) are short-circuited by the idempotency middleware
// before reaching this state machine.
// ─────────────────────────────────────────────────────────────────────────────

export const PaymentStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED']);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const PaymentMethodSchema = z.enum(['BANK_TRANSFER', 'MOBILE_MONEY']);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Payment record — what we store
// ─────────────────────────────────────────────────────────────────────────────

export interface PaymentRecord {
  paymentId: PaymentId;
  tenantId: TenantId;
  tenantPhone: Phone;
  /** Provider-side reference ID. Sent to FW at initiate; echoed back in webhook. */
  txRef: string;
  /** Naira amount the user committed to pay. Compared to webhook amount on confirmation. */
  expectedAmountNgn: number;
  /** Integer mGRD that will be minted on CONFIRMED. Locked at initiate time so rate changes mid-flight don't shift it. */
  expectedMGrd: number;
  method: PaymentMethod;
  status: PaymentStatus;
  /** Provider name — 'flutterwave' for MVP, expandable. */
  provider: string;
  /** When the payment was initiated (epoch ms). */
  createdAt: number;
  /** Last update (epoch ms). */
  updatedAt: number;
  /** When the payment was actually confirmed/failed/expired. Null while PENDING. */
  resolvedAt: number | null;
  /** Free-form failure reason if status is FAILED. Null otherwise. */
  failureReason: string | null;
}
