import { TwilioProvider } from './twilio.provider.js';
import { MetaProvider } from './meta.provider.js';

export function createProvider(env, logger) {
  if (env.botProvider === 'meta') return new MetaProvider({ config: env.meta, logger });
  return new TwilioProvider({ config: env.twilio, logger });
}
