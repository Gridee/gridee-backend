import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/lib/errors';
import {
  FlutterwavePaymentProvider,
  PaymentEventParseError,
} from '../../src/webhooks';

const SECRET = 'test-secret-hash-value-12345';
const make = (): FlutterwavePaymentProvider =>
  new FlutterwavePaymentProvider({ secretHash: SECRET });

describe('FlutterwavePaymentProvider — construction', () => {
  it('rejects empty secret', () => {
    expect(() => new FlutterwavePaymentProvider({ secretHash: '' })).toThrow(ConfigError);
  });

  it('exposes name', () => {
    expect(make().name).toBe('flutterwave');
  });
});

describe('FlutterwavePaymentProvider — verifySignature', () => {
  const body = Buffer.from('{}');

  it('accepts the configured secret', () => {
    expect(make().verifySignature(body, SECRET)).toBe(true);
  });

  it('rejects undefined header', () => {
    expect(make().verifySignature(body, undefined)).toBe(false);
  });

  it('rejects empty header', () => {
    expect(make().verifySignature(body, '')).toBe(false);
  });

  it('rejects mismatched secret', () => {
    expect(make().verifySignature(body, 'wrong-value')).toBe(false);
  });

  it('rejects different-length secret without throwing', () => {
    expect(make().verifySignature(body, 'short')).toBe(false);
  });

  it('rejects subtle one-character difference (timing-safe)', () => {
    const almost = SECRET.slice(0, -1) + 'X';
    expect(make().verifySignature(body, almost)).toBe(false);
  });
});

describe('FlutterwavePaymentProvider — parseEvent', () => {
  it('parses charge.completed successful → completed event', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: {
          id: 12345,
          tx_ref: 'TX_abc',
          amount: 5000,
          currency: 'NGN',
          status: 'successful',
        },
      }),
    );
    const event = make().parseEvent(body);
    expect(event).not.toBeNull();
    expect(event!.eventId).toBe('12345');
    expect(event!.txRef).toBe('TX_abc');
    expect(event!.outcome).toBe('completed');
    expect(event!.amountNgn).toBe(5000);
    expect(event!.currency).toBe('NGN');
  });

  it('parses charge.completed failed → failed event with reason', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: {
          id: 99999,
          tx_ref: 'TX_xyz',
          amount: 5000,
          currency: 'NGN',
          status: 'failed',
          failure_reason: 'insufficient funds',
        },
      }),
    );
    const event = make().parseEvent(body);
    expect(event!.outcome).toBe('failed');
    expect(event!.failureReason).toBe('insufficient funds');
  });

  it('falls back to processor_response when failure_reason is absent', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: {
          id: 1,
          tx_ref: 'TX_1',
          amount: 100,
          currency: 'NGN',
          status: 'failed',
          processor_response: 'card declined',
        },
      }),
    );
    const event = make().parseEvent(body);
    expect(event!.failureReason).toBe('card declined');
  });

  it('returns null for non-charge.completed events', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'transfer.completed',
        data: {
          id: 1, tx_ref: 'TX_1', amount: 100, currency: 'NGN', status: 'successful',
        },
      }),
    );
    expect(make().parseEvent(body)).toBeNull();
  });

  it('returns null for pending status', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: { id: 1, tx_ref: 'TX_1', amount: 100, currency: 'NGN', status: 'pending' },
      }),
    );
    expect(make().parseEvent(body)).toBeNull();
  });

  it('throws PaymentEventParseError on invalid JSON', () => {
    const body = Buffer.from('not json');
    expect(() => make().parseEvent(body)).toThrow(PaymentEventParseError);
  });

  it('throws PaymentEventParseError on missing tx_ref', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: { id: 1, amount: 100, currency: 'NGN', status: 'successful' },
      }),
    );
    expect(() => make().parseEvent(body)).toThrow(PaymentEventParseError);
  });

  it('coerces numeric id to string', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: { id: 999_888_777, tx_ref: 'TX_1', amount: 100, currency: 'NGN', status: 'successful' },
      }),
    );
    const event = make().parseEvent(body);
    expect(event!.eventId).toBe('999888777');
  });

  it('uppercases currency', () => {
    const body = Buffer.from(
      JSON.stringify({
        event: 'charge.completed',
        data: { id: 1, tx_ref: 'TX_1', amount: 100, currency: 'ngn', status: 'successful' },
      }),
    );
    const event = make().parseEvent(body);
    expect(event!.currency).toBe('NGN');
  });

  it('preserves rawPayload for audit', () => {
    const payload = {
      event: 'charge.completed',
      data: {
        id: 1,
        tx_ref: 'TX_1',
        amount: 100,
        currency: 'NGN',
        status: 'successful',
      },
    };
    const event = make().parseEvent(Buffer.from(JSON.stringify(payload)));
    expect(event!.rawPayload).toEqual(payload);
  });
});
