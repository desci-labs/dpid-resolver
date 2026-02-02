import { redisService } from "./redis.js";
import parentLogger from "./logger.js";
import { DPID_ENV, dpidAliasRegistry } from "./util/config.js";
import type { DpidAliasRegistry } from "@desci-labs/desci-contracts/dist/typechain-types/DpidAliasRegistry.js";
import { errWithCause } from "pino-std-serializers";

const MODULE_PATH = "chain.ts" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

const dpidAliasCacheKey = (dpid: number) => `resolver-${DPID_ENV}-dpid-alias-${dpid}`;
/* Cache bound aliases for a month as they are immutable */
const BOUND_ALIAS_TTL = 60 * 60 * 24 * 30;

export const cachedDpidLookup = async (dpid: number): Promise<string | undefined> => {
    // Check cache
    let streamId = await redisService?.getFromCache<string>(dpidAliasCacheKey(dpid));
    if (streamId && streamId !== "") {
        logger.info({ dpid, streamId }, "Got stream for dpid from cache");
        void redisService?.keyBump(dpidAliasCacheKey(dpid), BOUND_ALIAS_TTL);
        return streamId;
    }

    streamId = await dpidAliasRegistry.registry(dpid);
    // eth mappings return the empty type for unmapped entries
    if (streamId && streamId !== "") {
        logger.info({ dpid, streamId }, "Got stream for dpid from registry");
        void redisService?.setToCache(dpidAliasCacheKey(dpid), streamId, BOUND_ALIAS_TTL);
        return streamId;
    }

    return undefined;
};

const legacyDpidCacheKey = (dpid: number) => `resolver-${DPID_ENV}-legacy-dpid-${dpid}`;

/* Cache legacy entries as well, this is OK since:
 * 1. legacy entries are never updated
 * 2. we always check the main registry before falling back to legacy lookup
 *
 * Otherwise, we might keep serving legacy dPIDs after it has been migrated (which is bad).
 */
const LEGACY_DPID_TTL = 60 * 60 * 24 * 30;

export const cachedLegacyDpidLookup = async (
    dpid: number,
): Promise<DpidAliasRegistry.LegacyDpidEntryStructOutput | undefined> => {
    // Check cache
    let legacyEntry = await redisService?.getFromCache<DpidAliasRegistry.LegacyDpidEntryStructOutput>(
        legacyDpidCacheKey(dpid),
    );

    if (legacyEntry) {
        logger.info({ dpid }, "Got legacy dpid entry from cache");
        void redisService?.keyBump(legacyDpidCacheKey(dpid), LEGACY_DPID_TTL);
        return legacyEntry;
    }

    try {
        legacyEntry = await dpidAliasRegistry.legacyLookup(dpid);
        const owner = legacyEntry[0];
        const versions = legacyEntry[1] || [];

        // eth mappings return the empty type for unmapped entries
        if (!owner || versions.length === 0) {
            logger.info({ dpid, legacyEntry }, "Legacy dPID has no data");
            return undefined;
        }

        logger.info({ dpid }, "Got legacy dpid entry from chain");
        void redisService?.setToCache(legacyDpidCacheKey(dpid), legacyEntry, LEGACY_DPID_TTL);
        return legacyEntry;
    } catch (e) {
        logger.error({ dpid, error: errWithCause(e as Error) }, "Failed to lookup legacy dPID on chain");
    }

    return undefined;
};

const NEXT_DPID_CACHE_KEY = `resolver-${DPID_ENV}-next-dpid`;
/* Prevent hitting the chain on every request, but balance with delay for showing new dPIDs */
const NEXT_DPID_TTL = 60;

export const cachedNextDpid = async (): Promise<number | undefined> => {
    let nextDpid = await redisService?.getFromCache<number>(NEXT_DPID_CACHE_KEY);
    if (nextDpid) {
        logger.info({ nextDpid }, "Got next dPID from cache");
        // Note: bumping the cache TTL would prevent discovery of new dPIDs
        return nextDpid;
    }

    try {
        nextDpid = (await dpidAliasRegistry.nextDpid()).toNumber();
        if (nextDpid) {
            logger.info({ nextDpid }, "Got next dPID from chain");
            void redisService?.setToCache(NEXT_DPID_CACHE_KEY, nextDpid, NEXT_DPID_TTL);
            return nextDpid;
        }
    } catch (e) {
        logger.error({ nextDpid, error: errWithCause(e as Error) }, "Failed to get next dPID onchain");
    }

    return undefined;
};
