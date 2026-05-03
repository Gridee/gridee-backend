import { describe, expect, it } from 'vitest';
import {
  InMemoryWebhookIdempotencyStore,
  WebhookIdempotencyError,
  WebhookIdempotencyStoreFactory,
} from '../../src/webhooks';
import { ConfigError } from '../../src/lib/errors';

describe('InMemoryWebhookIdempotencyStore', () => {
  it('first markProcessed → true, subsequent → false', async () => {
    const store = new InMemoryWebhookIdempotencyStore();
    expect(await store.markProcessed('flutterwave:evt_1')).toBe(true);
    expect(await store.markProcessed('flutterwave:evt_1')).toBe(false);
    await store.close();
  });

  it('expires entries after TTL', async () => {
    const store = new InMemoryWebhookIdempotencyStore({ ttlMs: 50 });
    await store.markProcessed('k');
    await new Promise((r) => setTimeout(r, 80));
    expect(await store.markProcessed('k')).toBe(true);
    await store.close();
  });

  it('different keys do not collide', async () => {
    const store = new InMemoryWebhookIdempotencyStore();
    expect(await store.markProcessed('flutterwave:a')).toBe(true);
    expect(await store.markProcessed('flutterwave:b')).toBe(true);
    expect(await store.markProcessed('paystack:a')).toBe(true);
    await store.close();
  });

  it('enforces maxEntries cap', async () => {
    const store = new InMemoryWebhookIdempotencyStore({ maxEntries: 50, ttlMs: 60_000 });
    for (let i = 0; i < 50; i++) {
      await store.markProcessed(`k${i}`);
    }
    expect(store.size()).toBe(50);
    await store.markProcessed('overflow');
    expect(store.size()).toBeLessThanOrEqual(50);
    await store.close();
  });

  it('throws after close', async () => {
    const store = new InMemoryWebhookIdempotencyStore();
    await store.close();
    await expect(store.markProcessed('k')).rejects.toThrow(WebhookIdempotencyError);
  });
});

describe('WebhookIdempotencyStoreFactory', () => {
  it('creates memory store', () => {
    const store = WebhookIdempotencyStoreFactory.create({ type: 'memory' });
    expect(store).toBeInstanceOf(InMemoryWebhookIdempotencyStore);
  });

  it('rejects redis without URL', () => {
    expect(() => WebhookIdempotencyStoreFactory.create({ type: 'redis' })).toThrow(ConfigError);
  });

  it('rejects unknown type', () => {
    expect(() =>
      WebhookIdempotencyStoreFactory.create({ type: 'foo' as never }),
    ).toThrow(ConfigError);
  });
});
