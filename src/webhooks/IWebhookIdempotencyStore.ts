import { createClient, type RedisClientType } from 'redis';
import { ConfigError, GrideeError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Stores recently-seen webhook event IDs to detect provider redelivery.
 *
 * Same shape as the bot's `IInboundIdempotencyStore` — but kept as a separate
 * file (and namespace) because the storage scope is different (backend-side
 * webhook events vs bot-side inbound messages). Operationally, both can
 * point at the same Redis instance with different namespaces.
 */
export interface IWebhookIdempotencyStore {
  /**
   * Atomically check-and-set. Returns:
   *   true  → key was new; this is the first time we've seen the event
   *   false → key existed; this is a redelivery, skip processing
   */
  markProcessed(key: string): Promise<boolean>;

  /** Releases all resources. Idempotent. */
  close(): Promise<void>;
}

export class WebhookIdempotencyError extends GrideeError {}

// ─── In-memory ────────────────────────────────────────────────────────────

export interface InMemoryWebhookIdempotencyOptions {
  /** TTL in milliseconds. Default 24h. */
  ttlMs?: number;
  /** Soft cap on entries before pruning. Default 50_000. */
  maxEntries?: number;
}

export class InMemoryWebhookIdempotencyStore implements IWebhookIdempotencyStore {
  private readonly seen = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private closed = false;

  constructor(opts: InMemoryWebhookIdempotencyOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 50_000;
  }

  async markProcessed(key: string): Promise<boolean> {
    if (this.closed) throw new WebhookIdempotencyError('Store closed');
    const now = Date.now();
    const existing = this.seen.get(key);
    if (existing !== undefined && existing > now) return false;

    if (this.seen.size >= this.maxEntries) {
      this.evictExpired(now);
      if (this.seen.size >= this.maxEntries) {
        const drop = Math.ceil(this.maxEntries * 0.01);
        let dropped = 0;
        for (const k of this.seen.keys()) {
          this.seen.delete(k);
          if (++dropped >= drop) break;
        }
      }
    }
    this.seen.set(key, now + this.ttlMs);
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.seen.clear();
  }

  private evictExpired(now: number): void {
    for (const [k, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(k);
    }
  }

  /** Test helper. */
  size(): number {
    return this.seen.size;
  }
}

// ─── Redis ─────────────────────────────────────────────────────────────────

export interface RedisWebhookIdempotencyOptions {
  url: string;
  /** TTL in seconds. Default 86400 (24h). */
  ttlSeconds?: number;
  /** Key namespace. Default 'gridee:webhook'. */
  namespace?: string;
}

export class RedisWebhookIdempotencyStore implements IWebhookIdempotencyStore {
  private readonly client: RedisClientType;
  private readonly ttlSeconds: number;
  private readonly namespace: string;
  private connectPromise: Promise<void> | null = null;
  private closed = false;

  constructor(opts: RedisWebhookIdempotencyOptions) {
    if (!opts.url) throw new WebhookIdempotencyError('Redis URL required');
    this.ttlSeconds = opts.ttlSeconds ?? 24 * 60 * 60;
    this.namespace = opts.namespace ?? 'gridee:webhook';
    this.client = createClient({ url: opts.url });
    this.client.on('error', (err: Error) => {
      logger.error({ err: err.message }, 'Redis webhook idempotency client error');
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new WebhookIdempotencyError('Store closed');
    if (this.client.isOpen) return;
    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        try {
          await this.client.connect();
        } catch (err) {
          this.connectPromise = null;
          throw new WebhookIdempotencyError(
            `Redis connection failed: ${(err as Error).message}`,
            err,
          );
        }
      })();
    }
    await this.connectPromise;
  }

  async markProcessed(key: string): Promise<boolean> {
    await this.ensureConnected();
    const fullKey = `${this.namespace}:${key}`;
    try {
      const result = await this.client.set(fullKey, '1', {
        NX: true,
        EX: this.ttlSeconds,
      });
      return result === 'OK';
    } catch (err) {
      throw new WebhookIdempotencyError(
        `Redis SET NX failed: ${(err as Error).message}`,
        err,
      );
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.client.isOpen) {
      try {
        await this.client.quit();
      } catch {
        try {
          await this.client.disconnect();
        } catch {
          /* ignore */
        }
      }
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

export type WebhookIdempotencyStoreType = 'memory' | 'redis';

export interface WebhookIdempotencyStoreFactoryConfig {
  type: WebhookIdempotencyStoreType;
  ttlSeconds?: number;
  redisUrl?: string;
  redisNamespace?: string;
}

export class WebhookIdempotencyStoreFactory {
  static create(config: WebhookIdempotencyStoreFactoryConfig): IWebhookIdempotencyStore {
    switch (config.type) {
      case 'memory': {
        const opts: InMemoryWebhookIdempotencyOptions = {};
        if (config.ttlSeconds !== undefined) opts.ttlMs = config.ttlSeconds * 1000;
        return new InMemoryWebhookIdempotencyStore(opts);
      }
      case 'redis': {
        if (!config.redisUrl) {
          throw new ConfigError("redisUrl is required when idempotency type='redis'");
        }
        const opts: RedisWebhookIdempotencyOptions = { url: config.redisUrl };
        if (config.ttlSeconds !== undefined) opts.ttlSeconds = config.ttlSeconds;
        if (config.redisNamespace !== undefined) opts.namespace = config.redisNamespace;
        return new RedisWebhookIdempotencyStore(opts);
      }
      default: {
        const _exhaustive: never = config.type;
        throw new ConfigError(`Unknown webhook idempotency store type: ${String(_exhaustive)}`);
      }
    }
  }
}
