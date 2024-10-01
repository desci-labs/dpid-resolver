import type { Request, Response } from "express";
import parentLogger from "../../../logger.js";
import { CACHE_TTL_ANCHORED, CACHE_TTL_PENDING, DPID_ENV, getDpidAliasRegistry } from "../../../util/config.js";
import { ResolverError } from "../../../errors.js";
import { getCodexHistory, type HistoryQueryResult, type HistoryVersion } from "../queries/history.js";
import { getFromCache, setToCache } from "../../../redis.js";
import type { DpidAliasRegistry } from "@desci-labs/desci-contracts/dist/typechain-types/DpidAliasRegistry.js";
import { BigNumber } from "ethers";

const MODULE_PATH = "/api/v2/resolvers/codex" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

export type ResolveDpidRequest = {
    dpid: number;
    /** Zero-indexed version */
    versionIx?: number;
};

export type ResolveDpidResponse = HistoryQueryResult | ResolveDpidError;

export type ResolveDpidError = {
    error: string;
    details: unknown;
    params: ResolveDpidRequest;
    path: typeof MODULE_PATH;
};

/**
 * Find the history of a dPID. Note that streamID and version ID will be empty
 * strings in case a dPID is resolved through the legacy mapping.
 */
export const resolveDpidHandler = async (
    req: Request<ResolveDpidRequest>,
    res: Response<ResolveDpidResponse>,
): Promise<typeof res> => {
    logger.info(
        {
            params: req.params,
            query: req.query,
            path: req.path,
        },
        "Entered handler",
    );

    const { dpid, versionIx } = req.params;

    let result: HistoryQueryResult;
    try {
        result = await resolveDpid(dpid, versionIx);
    } catch (e) {
        if (e instanceof DpidResolverError) {
            const errPayload = {
                error: e.message,
                details: e.cause,
                params: req.params,
                path: MODULE_PATH,
            };
            logger.error(errPayload);
            return res.status(500).send(errPayload);
        } else {
            const err = e as Error;
            const errPayload = {
                error: err.message,
                details: err,
                params: req.params,
                path: MODULE_PATH,
            };
            logger.error(errPayload, "Unexpected error occurred");
            return res.status(501).send(errPayload);
        }
    }

    return res.status(200).send(result);
};

/** HistoryQueryResult possibly without stream ID and commit IDs, in case
 * resolution was made though the legacy mapping
 */
export type DpidHistoryQueryResult = Omit<HistoryQueryResult, "id" | "versions"> & {
    id?: string;
    versions: (Omit<HistoryVersion, "version"> & { version?: string })[];
};

// These key formats are reused for invalidation in the publish controller
const getKeyForDpid = (dpid: number) => `resolver-${DPID_ENV}-dpid-${dpid}`;
const getKeyForLegacyEntry = (dpid: number) => `resolver-${DPID_ENV}-legacy-${dpid}`;

/**
 * Lookup the history of a dPID
 * @returns dPID history
 * @throws (@link DpidResolverError) on failure
 */
export const resolveDpid = async (dpid: number, versionIx?: number): Promise<HistoryQueryResult> => {
    const registry = getDpidAliasRegistry();
    const streamCacheKey = getKeyForDpid(dpid);

    /** Empty string if dpid unmapped in registry */
    let streamId: string;
    try {
        let resolvedStream = await getFromCache<string>(streamCacheKey);
        if (resolvedStream === null) {
            resolvedStream = await registry.resolve(dpid);

            // Skip caching if dpid is unset to avoid resolution delay after publish
            if (resolvedStream.length) {
                setToCache(streamCacheKey, resolvedStream, CACHE_TTL_ANCHORED);
            }
        }
        streamId = resolvedStream;
    } catch (e) {
        throw new DpidResolverError({
            name: "RegistryContactFailed",
            message: "Failed to lookup dpid in alias registry",
            cause: e,
        });
    }

    let result: HistoryQueryResult;
    if (streamId !== "") {
        try {
            result = await getCodexHistory(streamId);
        } catch (e) {
            throw new DpidResolverError({
                name: "CeramicContactFailed",
                message: "Failed to resolve; does the dpid (or version) exist?",
                cause: e,
            });
        }
        logger.info({ dpid, streamId, manifest: result.manifest }, "manifest resolved via stream");
        return result;
    }

    logger.info({ dpid }, "alias not mapped, falling back to legacy lookup");
    try {
        const legacyHistoryCacheKey = getKeyForLegacyEntry(dpid);
        const fromCache = await getFromCache<string>(legacyHistoryCacheKey);

        let resolvedEntry: DpidAliasRegistry.LegacyDpidEntryStructOutput;
        if (fromCache === null) {
            resolvedEntry = await registry.legacyLookup(dpid);
            if (resolvedEntry.owner.length) {
                const asString = JSON.stringify(resolvedEntry);
                // We know this leads to a legacy entry, could probably cache it for longer.
                // It'll go stale if the dpid is upgraded, or the contracts are re-syced
                setToCache(legacyHistoryCacheKey, asString, CACHE_TTL_PENDING);
                setToCache(streamCacheKey, "", CACHE_TTL_PENDING);
            }
        } else {
            // The BigNumbers are parsed into objects, which ethers.BigNumber in fine with
            resolvedEntry = JSON.parse(fromCache);
        }

        const owner = resolvedEntry[0];
        const versions = undupeIfLegacyDevHistory(resolvedEntry[1]);
        const requestedVersion = versions[versionIx ?? versions.length - 1];

        result = {
            // No StreamID available
            id: "",
            owner,
            manifest: requestedVersion[0],
            versions: versions.map(([manifest, time]) => ({
                // No CommitID available
                version: "",
                // When restored from redis, the BigNumber is deserialised as a regular object
                // Ethers can instantiate the class from that format
                time: BigNumber.from(time).toNumber(),
                manifest,
            })),
        };
        logger.info(result, "manifest resolved via fallback to legacy entry");
        return result;
    } catch (e) {
        throw new DpidResolverError({
            name: "LegacyLookupError",
            message: "failed to lookup legacy dpid",
            cause: e,
        });
    }
};

type DpidErrorName = "RegistryContactFailed" | "CeramicContactFailed" | "LegacyLookupError" | "DpidNotFound";
export class DpidResolverError extends ResolverError<DpidErrorName> {}

type LegacyVersion = DpidAliasRegistry.LegacyVersionStructOutput;

const undupeIfLegacyDevHistory = (versions: LegacyVersion[]) => {
    if (DPID_ENV !== "dev") {
        return versions;
    }

    return versions.reduce((unduped, current) => {
        if (unduped.length === 0 || !isLegacyDupe(current, unduped[unduped.length - 1])) {
            unduped.push(current);
        }
        return unduped;
    }, [] as LegacyVersion[]);
};

const isLegacyDupe = (
    [aCid, aTimeBn]: LegacyVersion, 
    [bCid, bTimeBn]: LegacyVersion
): Boolean => {
    const cidIsEqual = aCid === bCid;
    const timeIsEqual = aTimeBn.toNumber() === bTimeBn.toNumber();
    return cidIsEqual && timeIsEqual;
};
