import type { Request, Response } from "express";
import parentLogger from "../../../logger.js";
import analytics, { LogEventType } from "../../../analytics.js";
import { getCodexHistories, type HistoryQueryResult } from "../queries/history.js";
import { getManifestMetadata, type ManifestMetadata } from "../../../util/manifests.js";
import { cachedDpidLookup, cachedLegacyDpidLookup, cachedNextDpid } from "../../../chain.js";
import { buildPagination, getPageIndices } from "../../../util/pagination.js";
import { errWithCause } from "pino-std-serializers";

const logger = parentLogger.child({ module: "api/v2/queries/dpids" });

/** Timeout for individual DPID lookups in milliseconds (3 seconds) */
const DPID_LOOKUP_TIMEOUT_MS = 3_000;

/** Result wrapper that distinguishes timeouts from other failures */
type TimeoutResult<T> = { result: T; timedOut: false } | { result: null; timedOut: true };

/**
 * Wraps a promise with a timeout. Returns a wrapper object that distinguishes
 * between timeouts and other null results from the underlying promise.
 * The timeout is properly cleaned up when the main promise resolves to prevent
 * spurious warning logs.
 */
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, dpidNumber: number): Promise<TimeoutResult<T>> => {
    let timeoutHandle: NodeJS.Timeout | null = null;
    let didTimeout = false;

    const timeoutPromise = new Promise<TimeoutResult<T>>((resolve) => {
        timeoutHandle = setTimeout(() => {
            didTimeout = true;
            logger.warn(
                { dpidNumber, timeoutMs },
                "DPID lookup timed out, skipping this dpid to avoid blocking the batch",
            );
            resolve({ result: null, timedOut: true });
        }, timeoutMs);
    });

    const wrappedPromise = promise.then((result) => {
        // Clear timeout if promise resolved before timeout fired
        if (timeoutHandle && !didTimeout) {
            clearTimeout(timeoutHandle);
        }
        return { result, timedOut: false as const };
    });

    return Promise.race([wrappedPromise, timeoutPromise]);
};

interface VersionData {
    index: number;
    cid: string;
    time: number | undefined;
}

/** Internal representation of DPID info before transforming to API response */
interface DpidInfo {
    dpid: number;
    owner: string;
    latestCid: string;
    versionCount: number;
    source: "ceramic" | "legacy";
    streamId: string;
    latestTimestamp: number | undefined;
    metadata?: ManifestMetadata;
    versions: VersionData[];
}

interface LegacyVersionEntry {
    0: string; // CID
    1: { toNumber?: () => number } | number; // timestamp
    [key: string]: unknown;
}

export type DpidVersion = {
    index: number;
    cid: string;
    time: number | undefined;
    resolveUrl: string;
};

export type DpidQueryResult = {
    dpid: number;
    owner: string;
    latestCid: string;
    versionCount: number;
    source: "ceramic" | "legacy";
    /** Timestamp of the latest version (anchor time), undefined if not yet anchored */
    latestTimestamp?: number;
    /** Only included when history=true */
    versions?: DpidVersion[];
    /** Only included when metadata=true */
    metadata?: ManifestMetadata;
    links: {
        history: string;
        latest: string;
        raw: string;
    };
};

export type DpidListResponse = {
    dpids: DpidQueryResult[];
    pagination: {
        page: number;
        size: number;
        total: number;
        hasNext: boolean;
        hasPrev: boolean;
        links: {
            self: string;
            first: string;
            prev: string | null;
            next: string | null;
            last: string;
            /** Link to same page with version history included (null if already included) */
            withHistory: string | null;
            /** Link to same page without version history (null if already excluded) */
            withoutHistory: string | null;
            /** Link to same page with manifest metadata included (null if already included) */
            withMetadata: string | null;
            /** Link to same page without manifest metadata (null if already excluded) */
            withoutMetadata: string | null;
        };
    };
};

export type DpidListQueryParams = {
    page?: string;
    size?: string;
    sort?: "asc" | "desc";
    history?: string; // "true" to include full version history
    metadata?: string; // "true" to resolve IPFS manifest metadata (authors, title, etc)
    fields?: string; // comma-separated list of metadata fields: "title,authors,description,keywords,license"
};

/**
 * Convert a HistoryQueryResult to the internal dpidInfo format.
 * Optionally includes full version history based on includeHistory flag.
 */
const historyToDpidInfo = (
    history: HistoryQueryResult,
    dpidNumber: number,
    includeHistory: boolean,
    metadata?: ManifestMetadata,
): DpidInfo => {
    const latestVersion = history.versions.at(-1);
    return {
        dpid: dpidNumber,
        owner: history.owner,
        latestCid: history.manifest,
        versionCount: history.versions.length,
        source: "ceramic" as const,
        streamId: history.id,
        latestTimestamp: latestVersion?.time ?? undefined,
        metadata,
        versions: includeHistory
            ? history.versions.map((v, index) => ({
                  index,
                  cid: v.manifest,
                  time: v.time,
              }))
            : [],
    };
};

/**
 * Fetch info for a Legacy DPID from the contract.
 * Only used for DPIDs that have no Ceramic streamId.
 */
const getLegacyDpidInfo = async (
    dpidNumber: number,
    includeHistory: boolean = false,
    includeMetadata: boolean = false,
    metadataFields: string[] = ["title", "authors"],
): Promise<DpidInfo | null> => {
    const startTime = Date.now();
    try {
        const legacyStart = Date.now();
        const legacyEntry = await cachedLegacyDpidLookup(dpidNumber);
        const legacyTime = Date.now() - legacyStart;

        if (!legacyEntry) {
            return null;
        }

        const owner = legacyEntry[0];
        const versions = legacyEntry[1];
        const latestCid = versions[versions.length - 1]?.[0] || "";

        // Extract latest timestamp from the most recent version
        const latestVersionEntry = versions[versions.length - 1];
        let latestTimestamp: number | undefined = undefined;
        if (latestVersionEntry) {
            if (latestVersionEntry.time?.toNumber) {
                latestTimestamp = latestVersionEntry.time.toNumber();
            } else {
                const rawTimestamp = (latestVersionEntry as unknown as LegacyVersionEntry)[1];
                latestTimestamp = typeof rawTimestamp === "number" ? rawTimestamp : undefined;
            }
        }

        let metadata: ManifestMetadata | undefined;
        let metadataTime = 0;

        if (includeMetadata && latestCid) {
            const metadataStart = Date.now();
            metadata = (await getManifestMetadata(latestCid, metadataFields)) || undefined;
            metadataTime = Date.now() - metadataStart;
        }

        const totalTime = Date.now() - startTime;
        logger.info(
            {
                dpidNumber,
                legacyTime,
                metadataTime,
                totalTime,
                versionCount: versions.length,
                latestTimestamp,
                includeHistory,
                includeMetadata,
                metadataFields: includeMetadata ? metadataFields : undefined,
            },
            "Legacy DPID timing",
        );

        return {
            dpid: dpidNumber,
            owner,
            latestCid,
            versionCount: versions.length,
            source: "legacy" as const,
            streamId: "",
            latestTimestamp,
            metadata,
            versions: includeHistory
                ? versions.map((v, index: number) => {
                      let time: number | undefined = undefined;
                      if (v.time?.toNumber) {
                          time = v.time.toNumber();
                      } else {
                          const rawTime = (v as unknown as LegacyVersionEntry)[1];
                          time = typeof rawTime === "number" ? rawTime : undefined;
                      }
                      return {
                          index,
                          cid: v.cid || (v as unknown as LegacyVersionEntry)[0],
                          time,
                      };
                  })
                : [],
        };
    } catch (e) {
        const totalTime = Date.now() - startTime;
        logger.warn(
            { dpidNumber, totalTime, includeHistory, includeMetadata, error: (e as Error).message },
            "Failed to fetch legacy DPID info",
        );
        return null;
    }
};

export const dpidListHandler = async (
    req: Request<unknown, unknown, unknown, DpidListQueryParams>,
    res: Response<DpidListResponse | { error: string; details: unknown }>,
): Promise<typeof res> => {
    logger.info("GET /api/v2/query/dpids");

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const size = Math.min(50, Math.max(1, parseInt(req.query.size as string) || 20));
    const sort = req.query.sort === "asc" ? "asc" : "desc";
    const includeHistory = req.query.history === "true";
    const includeMetadata = req.query.metadata === "true";

    // Parse metadata fields (default to title and authors if not specified)
    const metadataFields = req.query.fields
        ? req.query.fields
              .split(",")
              .map((f) => f.trim())
              .filter((f) => f.length > 0)
        : ["title", "authors"];

    analytics.log({
        dpid: 0,
        version: 2,
        eventType: LogEventType.DPID_LIST,
        extra: {
            page,
            size,
            sort,
            includeHistory,
            includeMetadata,
            metadataFields: includeMetadata ? metadataFields : undefined,
        },
    });

    try {
        // Get total DPID count to compute query ranges
        let nextDpid = await cachedNextDpid();
        if (!nextDpid) {
            logger.error({ nextDpid }, "Failed to get next dPID, listing will be empty");
            nextDpid = 0;
        }
        const totalDpids = Math.max(0, nextDpid - 1);

        const paginationBaseUrl = `${req.protocol}://${req.get("host")}/api/v2/query/dpids`;

        if (totalDpids === 0) {
            const pagination = buildPagination(paginationBaseUrl, {
                page,
                size,
                total: 0,
                sort,
                includeHistory,
                includeMetadata,
                metadataFields,
            });

            return res.json({
                dpids: [],
                pagination,
            });
        }

        // Generate DPID numbers for this page using pagination helper
        const dpidNumbers = getPageIndices({ page, size, total: totalDpids, sort });
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const batchStart = Date.now();

        // Get all registry entries in parallel to identify Ceramic vs Legacy DPIDs
        const registryStart = Date.now();
        const registryPromises = dpidNumbers.map(async (dpidNumber) => {
            try {
                const streamId = await cachedDpidLookup(dpidNumber);
                return { dpidNumber, streamId: streamId && streamId !== "" ? streamId : null };
            } catch {
                return { dpidNumber, streamId: null };
            }
        });
        const registryResults = await Promise.all(registryPromises);
        const registryTime = Date.now() - registryStart;

        // Separate Ceramic DPIDs from Legacy DPIDs
        const ceramicDpids = registryResults.filter((r) => r.streamId !== null);
        const legacyDpids = registryResults.filter((r) => r.streamId === null);

        logger.info(
            {
                dpidCount: dpidNumbers.length,
                ceramicCount: ceramicDpids.length,
                legacyCount: legacyDpids.length,
                registryTime,
            },
            "Registry lookup completed",
        );

        // Step 4b: Fetch Ceramic and Legacy DPIDs concurrently
        const dpidInfos: DpidInfo[] = [];

        // Build streamId -> dpidNumber lookup for mapping results back
        const streamIdToDpid = new Map<string, number>();
        for (const { dpidNumber, streamId } of ceramicDpids) {
            if (streamId) streamIdToDpid.set(streamId, dpidNumber);
        }

        const streamIds = ceramicDpids.map((d) => d.streamId!);

        // Process Ceramic DPIDs: batch fetch histories, then fetch metadata
        const ceramicPromise = (async () => {
            if (streamIds.length === 0) return;

            const historyStart = Date.now();
            const histories = await getCodexHistories(streamIds);
            const historyTime = Date.now() - historyStart;
            logger.info(
                { streamCount: streamIds.length, foundCount: histories.length, historyTime, includeHistory },
                "Batch Ceramic fetch completed",
            );

            await Promise.all(
                histories.map(async (history) => {
                    const dpidNumber = streamIdToDpid.get(history.id);
                    if (dpidNumber === undefined) return;

                    let metadata: ManifestMetadata | undefined;
                    if (includeMetadata) {
                        metadata = (await getManifestMetadata(history.manifest, metadataFields)) || undefined;
                    }

                    dpidInfos.push(historyToDpidInfo(history, dpidNumber, includeHistory, metadata));
                }),
            );
        })();

        // Process Legacy DPIDs: individual contract lookups with timeout
        const legacyPromise = Promise.all(
            legacyDpids.map(async ({ dpidNumber }) => {
                const result = await withTimeout(
                    getLegacyDpidInfo(dpidNumber, includeHistory, includeMetadata, metadataFields),
                    DPID_LOOKUP_TIMEOUT_MS,
                    dpidNumber,
                );
                if (!result.timedOut && result.result) {
                    dpidInfos.push(result.result);
                }
            }),
        );

        // Wait for both to complete
        await Promise.all([ceramicPromise, legacyPromise]);

        const batchTime = Date.now() - batchStart;
        logger.info(
            {
                dpidCount: dpidNumbers.length,
                successCount: dpidInfos.length,
                failedCount: dpidNumbers.length - dpidInfos.length,
                batchTime,
                avgTimePerDpid: Math.round(batchTime / dpidNumbers.length),
            },
            "Batch DPID lookup completed",
        );

        // Step 5: Transform to API format
        const resolvedDpids = dpidInfos
            .map((info) => {
                const latestTimestamp = info.latestTimestamp ?? undefined;

                const baseResult = {
                    dpid: info.dpid,
                    owner: info.owner,
                    latestCid: info.latestCid,
                    versionCount: info.versionCount,
                    source: info.source,
                    latestTimestamp,
                    links: {
                        history: `${baseUrl}/api/v2/query/history/${info.dpid}`,
                        latest: `${baseUrl}/api/v2/resolve/dpid/${info.dpid}`,
                        raw: `${baseUrl}/${info.dpid}?raw`,
                    },
                };

                const result: DpidQueryResult = { ...baseResult };

                if (includeHistory && info.versions.length > 0) {
                    result.versions = info.versions.map((v: VersionData) => ({
                        index: v.index,
                        cid: v.cid,
                        time: v.time,
                        resolveUrl: `${baseUrl}/api/v2/resolve/dpid/${info.dpid}/v${v.index + 1}`,
                    }));
                }

                if (includeMetadata && info.metadata) {
                    result.metadata = info.metadata;
                }

                return result;
            })
            // Sort by dpid to maintain order (batch processing may have reordered)
            .sort((a, b) => (sort === "desc" ? b.dpid - a.dpid : a.dpid - b.dpid));

        // Step 6: Build response with pagination
        const pagination = buildPagination(paginationBaseUrl, {
            page,
            size,
            total: totalDpids,
            sort,
            includeHistory,
            includeMetadata,
            metadataFields,
        });

        return res.json({
            dpids: resolvedDpids,
            pagination,
        });
    } catch (err) {
        const error = err as Error;
        logger.error({ url: req.url, error: errWithCause(error) }, "Error fetching DPIDs");
        return res.status(500).json({
            error: "Failed to fetch DPIDs",
            details: error.message,
        });
    }
};
