import { createClient } from "redis";
import parentLogger from "./logger.js";

const port = parseInt(process.env.REDIS_PORT || "6379");
const host = process.env.REDIS_HOST || "localhost";
const isRedisEnabled = process.env.REDIS_ENABLED !== "false"; // Allow disabling Redis

const logger = parentLogger.child({
    module: "redis.ts",
    port,
    host,
    enabled: isRedisEnabled,
});

export const redisClient = createClient({
    socket: {
        host,
        port,
        reconnectStrategy: (retries) => Math.min(retries * 500, 5_000),
    },
});

async function initRedisClient() {
    if (!isRedisEnabled) {
        logger.info({ fn: "initRedisClient" }, "Redis is disabled via REDIS_ENABLED=false");
        return;
    }

    if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
        logger.warn({ fn: "initRedisClient" }, "Redis host or port is not defined, using local defaults");
        return;
    }

    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
}

initRedisClient();

redisClient.on("connect", () => {
    logger.info("Client successfully connected");
});

redisClient.on("error", (err) => {
    logger.error({ err }, "Client error");
});

export async function keyBump(key: string, ttl: number): Promise<void> {
    if (!redisClient.isReady) {
        logger.error({ fn: "keyBump", key, op: "bump" }, "client not connected");
        return;
    }
    logger.info({ fn: "keyBump", key, op: "bump" }, "refreshing cache ttl");
    await redisClient.expire(key, ttl);
}

export async function getFromCache<T>(key: string): Promise<T | null> {
    if (!isRedisEnabled) {
        return null; // Gracefully return null when Redis is disabled
    }

    if (!redisClient.isReady) {
        logger.error({ fn: "getFromCache", key, op: "get" }, "client not connected");
        return null;
    }

    const result = await redisClient.get(key);
    if (result === null) {
        logger.info({ fn: "getFromCache", key, op: "get" }, "key not found");
        return null;
    }

    logger.info({ fn: "getFromCache", key, op: "get" }, "key retrieved from cache");
    return JSON.parse(result);
}

export async function setToCache<T>(key: string, value: T, ttl: number): Promise<void> {
    if (!isRedisEnabled) {
        return; // Gracefully return when Redis is disabled
    }

    if (!redisClient.isReady) {
        logger.error({ fn: "setToCache", key, op: "set" }, "client not connected");
        return;
    }

    await redisClient.set(key, JSON.stringify(value), { EX: ttl });
    logger.info({ fn: "setToCache", key, op: "set" }, "added value to cache");
}
