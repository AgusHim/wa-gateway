import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
    redis: Redis | undefined;
};

function createRedisClient(): Redis {
    const url = process.env.REDIS_URL || "redis://localhost:6380";
    return new Redis(url, {
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: false,
    });
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
    globalForRedis.redis = redis;
}
