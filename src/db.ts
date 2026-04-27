import { Pool } from 'pg';
import { redis } from './redis';

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  user: process.env.DB_USER || 'gridee_user',
  password: process.env.DB_PASSWORD || 'gridee_pass',
  database: process.env.DB_NAME || 'gridee',
});

// Test connection if this file is executed directly
if (require.main === module) {
  (async () => {
    try {
      const client = await pool.connect();
      console.log('PostgreSQL connected successfully');
      client.release();
      await pool.end();

      const ping = await redis.ping();
      if (ping === 'PONG') {
        console.log('Redis connected successfully');
      } else {
        console.log('Redis ping returned:', ping);
      }
      redis.disconnect();

      process.exit(0);
    } catch (err) {
      console.error('Connection error:', err);
      process.exit(1);
    }
  })();
}
