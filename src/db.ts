import knex from 'knex';
import knexConfig from '../knexfile';
import { redis } from './redis';

const env = process.env.NODE_ENV || 'development';
const envConfig = knexConfig[env as keyof typeof knexConfig] || knexConfig.development;

const db = knex({
  ...envConfig,
  pool: {
    min: 2,
    max: 10,
    acquireTimeoutMillis: 30000,
    createTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
  },
});

export { db };

if (require.main === module) {
  (async () => {
    try {
      await db.raw('SELECT 1');
      console.log('PostgreSQL connected successfully via Knex');

      const ping = await redis.ping();
      if (ping === 'PONG') {
        console.log('Redis connected successfully');
      } else {
        console.log('Redis ping returned:', ping);
      }
      redis.disconnect();
      await db.destroy();

      process.exit(0);
    } catch (err) {
      console.error('Connection error:', err);
      process.exit(1);
    }
  })();
}
