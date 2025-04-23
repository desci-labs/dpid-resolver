import { createClient } from "redis";
import type { RedisClientType } from "redis";
import parentLogger from "./logger.js";

const logger = parentLogger.child({
    module: "redis.ts",
});

export function shouldStartRedis(): boolean {
    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT;

    if (!host || !port) {
        logger.warn({ host, port }, "Redis host or port is not defined, Redis service will not start");
        return false;
    }

    return true;
}

export interface RedisService {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    keyBump: (key: string, ttl: number) => Promise<void>;
    getFromCache: <T>(key: string) => Promise<T | null>;
    setToCache: <T>(key: string, value: T, ttl: number) => Promise<void>;
}

export interface RedisConfig {
    host: string;
    port: number;
}

export function createRedisService(config: RedisConfig): RedisService {
    let client: RedisClientType | null = null;
    let isRunning = false;

    const redisClient = createClient({
        socket: {
            host: config.host,
            port: config.port,
            reconnectStrategy: (retries) => {
                const backoff = Math.min(1_000 * 2 ** retries, 300_000);
                logger.info({ fn: "reconnectStrategy", retries, backoff }, "reconnecting...");
                return backoff;
            },
        },
    }) as RedisClientType;

    redisClient.on("connect", () => {
        logger.info("Client successfully connected");
    });

    redisClient.on("error", (err) => {
        logger.error({ err }, "Client error");
    });

    async function keyBump(key: string, ttl: number): Promise<void> {
        if (!client?.isReady) {
            logger.error({ fn: "keyBump", key, op: "bump" }, "client not connected");
            return;
        }
        logger.info({ fn: "keyBump", key, op: "bump" }, "refreshing cache ttl");
        await client.expire(key, ttl);
    }

    async function getFromCache<T>(key: string): Promise<T | null> {
        if (!client?.isReady) {
            logger.error({ fn: "getFromCache", key, op: "get" }, "client not connected");
            return null;
        }

        const result = await client.get(key);
        if (result === null) {
            logger.info({ fn: "getFromCache", key, op: "get" }, "key not found");
            return null;
        }

        logger.info({ fn: "getFromCache", key, op: "get" }, "key retrieved from cache");
        return JSON.parse(result);
    }

    async function setToCache<T>(key: string, value: T, ttl: number): Promise<void> {
        if (!client?.isReady) {
            logger.error({ fn: "setToCache", key, op: "set" }, "client not connected");
            return;
        }

        await client.set(key, JSON.stringify(value), { EX: ttl });
        logger.info({ fn: "setToCache", key, op: "set" }, "added value to cache");
    }

    return {
        async start() {
            if (isRunning) {
                logger.warn("Redis service is already running");
                return;
            }

            try {
                logger.info({ host: config.host, port: config.port }, "Starting Redis service");
                client = redisClient;
                await client.connect();
                isRunning = true;
            } catch (error) {
                logger.error(error, "Error starting Redis service");
                throw error;
            }
        },

        async stop() {
            if (!isRunning) {
                logger.warn("Redis service is not running");
                return;
            }

            try {
                logger.info("Stopping Redis service");
                if (client) {
                    await client.quit();
                }
                isRunning = false;
                client = null;
            } catch (error) {
                logger.error(error, "Error stopping Redis service");
                throw error;
            }
        },

        keyBump,
        getFromCache,
        setToCache,
    };
}
