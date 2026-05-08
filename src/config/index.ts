import { z } from 'zod';
import { ConfigError } from '../lib/errors';

/**
 * Backend env schema.
 *
 * Differences from the bot's config:
 * - No SESSION_STORE / SESSION_TTL_SECONDS (sessions live in the bot)
 * - No TWILIO_PUBLIC_WEBHOOK_URL (backend does not receive webhooks)
 * - No *_APP_SECRET / *_VERIFY_TOKEN / *_WEBHOOK_SECRET (inbound-only fields)
 * - Adds DATABASE_URL, FLUTTERWAVE_*, CONSUMPTION_*
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database (Ganiyat owns DB layer; stubbed here for completeness)
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/gridee'),

  // Redis — used for webhook idempotency, NOT session state
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_NAMESPACE: z.string().min(1).default('gridee-backend'),

  // Server
  PORT: z.coerce.number().int().positive().default(3000),

  // ── Messaging (OUTBOUND ONLY) ─────────────────────────────────────────
  MESSAGING_PROVIDER: z.enum(['twilio', 'whatsapp_cloud', 'africas_talking']).default('twilio'),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  WHATSAPP_API_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  AT_API_KEY: z.string().optional(),
  AT_USERNAME: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),

  // ── Payment provider (Mark) ───────────────────────────────────────────
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_WEBHOOK_SECRET: z.string().optional(),

  // ── Consumption engine ────────────────────────────────────────────────
  CONSUMPTION_KWH_PER_HOUR: z.coerce.number().positive().default(0.5),
  LOW_BALANCE_THRESHOLD: z.coerce.number().nonnegative().default(1.0),
});

export type Config = Readonly<z.infer<typeof EnvSchema>>;

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment configuration: ${issues}`);
  }
  cached = Object.freeze(result.data);
  return cached;
}

/** Test-only — reset the cache so tests can inject different env shapes. */
export function _resetConfigForTests(): void {
  cached = null;
}
