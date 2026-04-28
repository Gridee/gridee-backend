import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST ,
  port: parseInt(process.env.REDIS_PORT as string, 10),
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});
