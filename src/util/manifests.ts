import type { ResearchObjectV1 } from "@desci-labs/desci-models";
import parentLogger from "../logger.js";
import { DPID_ENV, IPFS_GATEWAY } from "./config.js";
import { redisService } from "../redis.js";

const MODULE_PATH = "/util/manifests" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

const manifestCacheKey = (cid: string) => `resolver-${DPID_ENV}-manifest-${cid}`;
/* Cache manifests for a month as they are content addressed */
const MANIFEST_CACHE_TTL = 60 * 60 * 24 * 30;

export const getManifest = async (cid: string): Promise<ResearchObjectV1 | undefined> => {
    if (!cid) {
        logger.warn("getManifest got undefined CID");
        return undefined;
    }

    const startTime = Date.now();

    // Try cache
    const cachedManifest = await redisService?.getFromCache(manifestCacheKey(cid));
    if (cachedManifest) {
        logger.info({ cid, fetchTime: Date.now() - startTime }, "Fetched manifest from cache");
        // bump cache TTL as the manifest is actively resolved
        void redisService?.keyBump(manifestCacheKey(cid), MANIFEST_CACHE_TTL);
        return cachedManifest as ResearchObjectV1;
    }

    let response;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        response = await fetch(`${IPFS_GATEWAY}/${cid}`, {
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
    } catch (error) {
        if ((error as Error).name === "AbortError") {
            logger.warn({ cid, fetchTime: Date.now() - startTime }, "Manifest fetch timed out");
        } else {
            logger.error({ cid, error }, "Error fetching manifest from IPFS gateway");
        }
        return undefined;
    }

    const fetchTime = Date.now() - startTime;

    if (!response.ok) {
        logger.error({ cid, fetchTime }, "Failed to fetch manifest from IPFS gateway");
        return undefined;
    }

    let parsedManifest: ResearchObjectV1;
    try {
        parsedManifest = (await response.json()) as ResearchObjectV1;
        void redisService?.setToCache(manifestCacheKey(cid), parsedManifest, MANIFEST_CACHE_TTL);
    } catch (_) {
        logger.error({ cid, fetchTime }, "Failed to parse manifest");
        return undefined;
    }
    return parsedManifest;
};
