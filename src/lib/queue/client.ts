import Redis, { RedisOptions } from "ioredis";

const globalForRedis = globalThis as unknown as {
    redis: Redis | undefined;
};

function createRedisClient(): Redis {
    const url = process.env.REDIS_URL || "redis://localhost:6380";
    const baseOptions: RedisOptions = {
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: false,
    };

    try {
        const parsed = new URL(url);
        const options: RedisOptions = {
            ...baseOptions,
            host: parsed.hostname,
            port: Number(parsed.port || (parsed.protocol === "rediss:" ? "6380" : "6379")),
        };

        if (parsed.username) {
            options.username = decodeURIComponent(parsed.username);
        }

        if (parsed.password) {
            options.password = decodeURIComponent(parsed.password);
        }

        const dbPath = parsed.pathname.replace(/^\//, "").trim();
        if (dbPath) {
            const db = Number(dbPath);
            if (Number.isFinite(db) && db >= 0) {
                options.db = Math.floor(db);
            }
        }

        if (parsed.protocol === "rediss:") {
            options.tls = {};
        }

        return new Redis(options);
    } catch {
        // Fallback for non-URL Redis config formats.
        return new Redis(url, baseOptions);
    }
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
    globalForRedis.redis = redis;
}
