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
 * Uses the contract's `find` function for O(1) lookup from the
 * streamID -> dpid mapping. Results are cached for performance.
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
                void redisService.keyBump(getReverseLookupCacheKey(streamId), CACHE_TTL_ANCHORED).catch((error) => {
                    logger.warn({ error, streamId }, "Failed to bump reverse lookup cache TTL");
                });
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

        // Use the contract's find function for O(1) reverse lookup
        // The contract maintains a streamID -> dpid mapping
        const dpidBigNumber = await registry.find(streamId);
        const dpid = dpidBigNumber.toNumber();

        // dpid of 0 means not found (DPIDs start at 1)
        if (dpid === 0) {
            logger.info({ streamId }, "no DPID found for stream ID");
            return res.status(404).send({
                error: "not found",
                details: `no DPID found for stream ID: ${streamId}`,
                params: req.params,
                path: MODULE_PATH,
            });
        }

        logger.info({ streamId, dpid, source: "registry" }, "reverse lookup found DPID");

        // Cache the result for future lookups
        if (redisService) {
            logger.info({ streamId, dpid }, "caching reverse lookup result in redis");
            void redisService
                .setToCache(getReverseLookupCacheKey(streamId), dpid, CACHE_TTL_ANCHORED)
                .catch((error) => {
                    logger.warn({ error, streamId }, "Failed to cache reverse lookup result");
                });
        } else {
            logger.info({ streamId, dpid }, "redis not available, skipping cache");
        }

        return res.send({
            dpid,
            streamId,
            links: {
                resolve: `${baseUrl}/api/v2/resolve/dpid/${dpid}`,
                history: `${baseUrl}/api/v2/query/history/${dpid}`,
            },
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
