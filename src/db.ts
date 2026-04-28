import knex from 'knex';
import knexConfig from '../knexfile';
import { redis } from './redis';

export const db = knex(knexConfig.development);

// Test connection if this file is executed directly
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
