import Redis from "ioredis";

export const redis = new Redis(process.env.REDIS_URL as string, {
  maxRetriesPerRequest: null, // prevents weird command failures
  enableReadyCheck: true,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 3000);
    console.log(`[Redis] reconnecting in ${delay}ms...`);
    return delay;
  },
});

redis.on("connect", () => {
  console.log("Redis connected");
});

redis.on("ready", () => {
  console.log("Redis ready");
});

redis.on("error", (err) => {
  console.error("Redis error:", err.message);
});

redis.on("close", () => {
  console.warn("Redis connection closed");
});

redis.on("reconnecting", () => {
  console.log("Redis reconnecting...");
});