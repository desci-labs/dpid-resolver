import { createClient } from "redis";
import type { RedisClientType } from "redis";
import parentLogger from "./logger.js";
import { errWithCause } from "pino-std-serializers";

const logger = parentLogger.child({
    module: "redis.ts",
});

export function shouldStartRedis(): boolean {
    const host = process.env.REDIS_HOST;
    const port = process.env.REDIS_PORT;
    const isRedisEnabled = process.env.REDIS_ENABLED !== "false"; // Allow disabling Redis

    if (!isRedisEnabled) {
        logger.info({ fn: "shouldStartRedis" }, "Redis is disabled via REDIS_ENABLED=false");
        return false;
    }

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
    setToCache: <T>(key: string, value: T, ttl: number) => Promise<boolean>;
    del: (...keys: string[]) => Promise<void>;
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
            logger.warn({ fn: "keyBump", key, op: "bump" }, "client not connected");
            return;
        }
        logger.info({ fn: "keyBump", key, op: "bump" }, "refreshing cache ttl");
        try {
            await client.expire(key, ttl);
        } catch (e) {
            logger.warn({ fn: "keyBump", key, op: "bump", error: errWithCause(e as Error) }, "failed to bump key");
        }
    }

    async function getFromCache<T>(key: string): Promise<T | null> {
        if (!client?.isReady) {
            logger.warn({ fn: "getFromCache", key, op: "get" }, "client not connected");
            return null;
        }

        let result;
        try {
            result = await client.get(key);
            if (result === null) {
                logger.info({ fn: "getFromCache", key, op: "get" }, "key not found");
                return null;
            }
        } catch (e) {
            logger.warn({ fn: "getFromCache", key, op: "get" }, "Failed to get key from cache");
            return null;
        }

        try {
            logger.info({ fn: "getFromCache", key, op: "get" }, "key retrieved from cache");
            return JSON.parse(result);
        } catch (e) {
            logger.error(
                { fn: "getFromCache", key, op: "parse", error: errWithCause(e as Error) },
                "failed to parse cached value, purging key",
            );
            await client.del(key).catch((e) => {
                logger.warn(
                    { fn: "getFromCache", key, op: "del", error: errWithCause(e as Error) },
                    "failed to del key",
                );
            });
            return null;
        }
    }

    async function setToCache<T>(key: string, value: T, ttl: number): Promise<boolean> {
        if (!client?.isReady) {
            logger.warn({ fn: "setToCache", key, op: "set" }, "client not connected");
            return false;
        }

        try {
            await client.set(key, JSON.stringify(value), { EX: ttl });
            logger.info({ fn: "setToCache", key, op: "set" }, "added value to cache");
            return true;
        } catch (e) {
            logger.warn(
                { fn: "setToCache", key, op: "set", error: errWithCause(e as Error) },
                "Failed to set key to cache",
            );
            return false;
        }
    }

    async function del(...keys: string[]): Promise<void> {
        if (!client?.isReady) {
            logger.warn({ fn: "del", keys, op: "del" }, "client not connected");
            return;
        }

        if (keys.length === 0) {
            return;
        }

        try {
            await client.del(keys);
            logger.info({ fn: "del", keys, op: "del" }, "deleted key from cache");
        } catch (e) {
            logger.warn(
                { fn: "del", keys, op: "del", error: errWithCause(e as Error) },
                "failed to del key from cache",
            );
        }
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
        del,
    };
}

// Export the redisService variable for external initialization
export let redisService: RedisService | undefined;

export async function maybeInitializeRedis(): Promise<void> {
    if (shouldStartRedis()) {
        redisService = createRedisService({
            host: process.env.REDIS_HOST!,
            port: parseInt(process.env.REDIS_PORT!),
        });
        await redisService.start();
    }
}
