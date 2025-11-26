import type { Request, Response } from "express";
import { CACHE_TTL_ANCHORED, DPID_ENV, getDpidAliasRegistry } from "../../../util/config.js";
import parentLogger from "../../../logger.js";
import { redisService } from "../../../redis.js";

const MODULE_PATH = "api/v2/queries/reverseLookup" as const;
const logger = parentLogger.child({ module: MODULE_PATH });

type ReverseLookupParams = {
    /** Stream ID to look up */
    id?: string;
};

type ReverseLookupSuccessResponse = {
    dpid: number;
    streamId: string;
    links: {
        resolve: string;
        history: string;
    };
};

type ReverseLookupErrorResponse = {
    error: string;
    details: string;
    params: unknown;
    path: typeof MODULE_PATH;
};

type ReverseLookupResponse = ReverseLookupSuccessResponse | ReverseLookupErrorResponse;

/**
 * Cache key for reverse lookup (streamId -> dpid mapping)
 */
const getReverseLookupCacheKey = (streamId: string) => `resolver-${DPID_ENV}-reverse-${streamId}`;

/**
 * Reverse lookup: given a stream ID, find the corresponding DPID
 *
 * This endpoint iterates through all registered DPIDs to find which one
 * maps to the provided stream ID. Results are cached for performance.
 */
export const reverseLookupHandler = async (
    req: Request<ReverseLookupParams, unknown, unknown>,
    res: Response<ReverseLookupResponse>,
): Promise<typeof res> => {
    const { id: streamId } = req.params;

    if (!streamId) {
        return res.status(400).send({
            error: "invalid request",
            details: "missing stream ID in path parameter",
            params: req.params,
            path: MODULE_PATH,
        });
    }

    logger.info({ streamId }, "handling reverse lookup query");

    try {
        const baseUrl = `${req.protocol}://${req.get("host")}`;

        // Check cache first
        if (redisService) {
            logger.info({ streamId }, "redis service available, checking cache");
            const cachedDpid = await redisService.getFromCache<number>(getReverseLookupCacheKey(streamId));
            if (cachedDpid !== null) {
                logger.info({ streamId, dpid: cachedDpid, source: "cache" }, "reverse lookup cache hit");
                return res.send({
                    dpid: cachedDpid,
                    streamId,
                    links: {
                        resolve: `${baseUrl}/api/v2/resolve/dpid/${cachedDpid}`,
                        history: `${baseUrl}/api/v2/query/history/${cachedDpid}`,
                    },
                });
            }
            logger.info({ streamId }, "cache miss, proceeding with registry lookup");
        } else {
            logger.info({ streamId }, "redis service not available, skipping cache");
        }

        const registry = getDpidAliasRegistry();

        // Get the total number of DPIDs
        const nextDpidBigNumber = await registry.nextDpid();
        const nextDpid = nextDpidBigNumber.toNumber();

        if (nextDpid <= 1) {
            return res.status(404).send({
                error: "not found",
                details: "no DPIDs registered in the system",
                params: req.params,
                path: MODULE_PATH,
            });
        }

        // Search through all DPIDs to find the one matching the stream ID
        // Use batched parallel lookups for better performance
        const BATCH_SIZE = 50;
        const totalDpids = nextDpid - 1;

        for (let batchStart = 1; batchStart <= totalDpids; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalDpids);
            const dpidNumbers = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

            const lookupPromises = dpidNumbers.map(async (dpidNumber) => {
                try {
                    const registeredStreamId = await registry.registry(dpidNumber);
                    if (registeredStreamId === streamId) {
                        return dpidNumber;
                    }
                } catch {
                    // Skip failed lookups
                }
                return null;
            });

            const results = await Promise.all(lookupPromises);
            const foundDpid = results.find((result) => result !== null);

            if (foundDpid) {
                logger.info({ streamId, dpid: foundDpid, source: "registry" }, "reverse lookup found DPID");

                // Cache the result for future lookups
                if (redisService) {
                    logger.info({ streamId, dpid: foundDpid }, "caching reverse lookup result in redis");
                    void redisService
                        .setToCache(getReverseLookupCacheKey(streamId), foundDpid, CACHE_TTL_ANCHORED)
                        .catch((error) => {
                            logger.warn({ error, streamId }, "Failed to cache reverse lookup result");
                        });
                } else {
                    logger.info({ streamId, dpid: foundDpid }, "redis not available, skipping cache");
                }

                return res.send({
                    dpid: foundDpid,
                    streamId,
                    links: {
                        resolve: `${baseUrl}/api/v2/resolve/dpid/${foundDpid}`,
                        history: `${baseUrl}/api/v2/query/history/${foundDpid}`,
                    },
                });
            }
        }

        // Stream ID not found in any DPID registration
        return res.status(404).send({
            error: "not found",
            details: `no DPID found for stream ID: ${streamId}`,
            params: req.params,
            path: MODULE_PATH,
        });
    } catch (error) {
        logger.error(error, "Error in reverse lookup handler");
        return res.status(500).send({
            error: "internal server error",
            details: error instanceof Error ? error.message : "unknown error",
            params: req.params,
            path: MODULE_PATH,
        });
    }
};

