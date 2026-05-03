import { db } from './src/db';
import { redis } from './src/redis';

async function clear() {
  console.log('🧹 Starting full database and Redis cleanup...');
  try {
    // 1. Clear Database
    // Order matters because of foreign key constraints
    await db('transactions').del();
    await db('notifications').del();
    await db('tenants').del();
    await db('properties').del();
    await db('users').del();
    
    // Reset sequences (for PostgreSQL)
    await db.raw('ALTER SEQUENCE users_id_seq RESTART WITH 1');
    await db.raw('ALTER SEQUENCE properties_id_seq RESTART WITH 1');
    await db.raw('ALTER SEQUENCE tenants_id_seq RESTART WITH 1');
    await db.raw('ALTER SEQUENCE transactions_id_seq RESTART WITH 1');
    await db.raw('ALTER SEQUENCE notifications_id_seq RESTART WITH 1');
    console.log('✅ Database cleared and sequences reset.');

    // 2. Clear Redis
    await redis.flushall();
    console.log('✅ Redis cache cleared (FLUSHALL).');

    console.log('\n🌟 SUCCESS: Everything is now clean and ready for a fresh demo!');
  } catch (e) {
    console.error('❌ Cleanup failed:', e);
  } finally {
    process.exit(0);
  }
}
clear();
