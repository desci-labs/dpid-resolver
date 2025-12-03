import type { Request, Response } from "express";
import parentLogger from "../../../logger.js";
import { CACHE_TTL_ANCHORED, CACHE_TTL_PENDING, DPID_ENV, dpidAliasRegistry } from "../../../util/config.js";
import { ResolverError } from "../../../errors.js";
import { getCodexHistory, type HistoryQueryResult, type HistoryVersion } from "../queries/history.js";
import { redisService } from "../../../redis.js";
import type { DpidAliasRegistry } from "@desci-labs/desci-contracts/dist/typechain-types/DpidAliasRegistry.js";
import { BigNumber } from "ethers";
import { isVersionString } from "../../../util/validation.js";

const MODULE_PATH = "/api/v2/resolvers/dpid" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

export type ResolveDpidRequest = {
    dpid: string; // Route params are always strings
    /** Zero-indexed version, comes as string from route */
    versionIx?: string;
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

    // Parse version string to numeric index if needed
    let parsedVersionIx: number | undefined;
    if (versionIx && isVersionString(versionIx)) {
        parsedVersionIx = getVersionIndex(versionIx);
        logger.info({ dpid, versionIx, parsedVersionIx }, "parsed version string");
    } else if (versionIx) {
        // If versionIx exists but isn't a valid version string, it's invalid
        const errPayload = {
            error: "Invalid version format",
            details: `Version '${versionIx}' must be a number or 'vN' format (e.g., 'v1', 'v2')`,
            params: req.params,
            path: MODULE_PATH,
        };
        return res.status(400).json(errPayload);
    }

    let result: HistoryQueryResult;
    try {
        result = await resolveDpid(parseInt(dpid), parsedVersionIx);
    } catch (e) {
        if (e instanceof DpidResolverError) {
            const errPayload = {
                error: e.message,
                details: e.cause,
                params: req.params,
                path: MODULE_PATH,
            };
            logger.error({ details: e.cause, params: req.params, path: req.path, error: e.message });
            return res.status(404).json(errPayload); // Use 404 for DpidNotFound errors
        } else {
            const error = e as Error;
            const errPayload = {
                error: "failed to lookup legacy dpid",
                details: {
                    type: error.constructor.name,
                    message: error.message,
                    stack: error.stack,
                },
                params: req.params,
                path: MODULE_PATH,
            };
            logger.error({ details: errPayload.details, params: req.params, path: req.path, error: errPayload.error });
            return res.status(500).json(errPayload);
        }
    }

    return res.json(result);
};

/**
 * Convert version string to 0-based index
 * e.g., "v1" -> 0, "v6" -> 5, "3" -> 3
 */
const getVersionIndex = (versionString: string): number => {
    if (versionString.startsWith("v")) {
        // Convert 1-based to 0-based indexing
        return parseInt(versionString.slice(1)) - 1;
    } else {
        return parseInt(versionString);
    }
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
    const streamCacheKey = getKeyForDpid(dpid);

    /** Empty string if dpid unmapped in registry */
    let streamId: string;
    try {
        let resolvedStream: string;
        if (redisService) {
            const cachedStream = await redisService.getFromCache<string>(streamCacheKey);
            if (cachedStream === null) {
                resolvedStream = await dpidAliasRegistry.resolve(dpid);
                // Skip caching if dpid is unset to avoid resolution delay after publish
                if (resolvedStream.length) {
                    void redisService.setToCache(streamCacheKey, resolvedStream, CACHE_TTL_ANCHORED);
                }
            } else {
                resolvedStream = cachedStream;
            }
        } else {
            resolvedStream = await dpidAliasRegistry.resolve(dpid);
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

            // Handle version selection for stream-based DPIDs
            if (versionIx !== undefined) {
                if (versionIx < 0 || versionIx >= result.versions.length) {
                    throw new DpidResolverError({
                        name: "DpidNotFound",
                        message: `Version index ${versionIx} not found. Available versions: 0-${result.versions.length - 1}`,
                        cause: new Error(`Invalid version index: ${versionIx}`),
                    });
                }
                // Overwrite the top-level manifest with the specified version
                result.manifest = result.versions[versionIx].manifest;
                logger.info(
                    { dpid, streamId, versionIx, manifest: result.manifest },
                    "manifest resolved via stream with specific version",
                );
            } else {
                logger.info(
                    { dpid, streamId, manifest: result.manifest },
                    "manifest resolved via stream with latest version",
                );
            }
        } catch (e) {
            if (e instanceof DpidResolverError) {
                throw e;
            }
            throw new DpidResolverError({
                name: "CeramicContactFailed",
                message: "Failed to resolve; does the dpid (or version) exist?",
                cause: e,
            });
        }
        return result;
    }

    logger.info({ dpid }, "alias not mapped, falling back to legacy lookup");
    try {
        const legacyHistoryCacheKey = getKeyForLegacyEntry(dpid);
        let resolvedEntry: DpidAliasRegistry.LegacyDpidEntryStructOutput;

        if (redisService) {
            const fromCache = await redisService.getFromCache<string>(legacyHistoryCacheKey);
            if (fromCache === null) {
                resolvedEntry = await dpidAliasRegistry.legacyLookup(dpid);
                if (resolvedEntry.owner.length) {
                    const asString = JSON.stringify(resolvedEntry);
                    // We know this leads to a legacy entry, could probably cache it for longer.
                    // It'll go stale if the dpid is upgraded, or the contracts are re-syced
                    void redisService.setToCache(legacyHistoryCacheKey, asString, CACHE_TTL_PENDING).catch((error) => {
                        logger.warn(
                            { error, key: legacyHistoryCacheKey },
                            "Failed to set Redis cache for legacy history",
                        );
                    });
                }
            } else {
                resolvedEntry = JSON.parse(fromCache);
                // The BigNumbers are deserialized into objects, which ethers.BigNumber can instantiate from
                resolvedEntry[1].forEach((v) => {
                    v[1] = BigNumber.from(v[1]);
                });
            }
        } else {
            resolvedEntry = await dpidAliasRegistry.legacyLookup(dpid);
        }

        const owner = resolvedEntry[0];
        const versions = undupeIfLegacyDevHistory(resolvedEntry[1]);

        // Apply the same version validation as the Ceramic path
        let validatedVersionIx: number;
        if (versionIx !== undefined) {
            if (versionIx < 0 || versionIx >= versions.length) {
                throw new DpidResolverError({
                    name: "DpidNotFound",
                    message: `Version index ${versionIx} not found. Available versions: 0-${versions.length - 1}`,
                    cause: new Error(`Invalid version index: ${versionIx}`),
                });
            }
            validatedVersionIx = versionIx;
        } else {
            validatedVersionIx = versions.length - 1; // Default to latest version
        }

        const requestedVersion = versions[validatedVersionIx];

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
                time: time.toNumber(),
                manifest,
            })),
        };
        logger.info({ dpid, owner, manifest: result.manifest }, "manifest resolved via fallback to legacy entry");
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

const isLegacyDupe = ([aCid, aTimeBn]: LegacyVersion, [bCid, bTimeBn]: LegacyVersion): boolean => {
    const cidIsEqual = aCid === bCid;
    const timeIsEqual = aTimeBn.toNumber() === bTimeBn.toNumber();
    return cidIsEqual && timeIsEqual;
};
