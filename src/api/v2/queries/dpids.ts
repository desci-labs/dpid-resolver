import type { Request, Response } from "express";
import { dpidAliasRegistry, getCeramicClient } from "../../../util/config.js";
import parentLogger from "../../../logger.js";
import analytics, { LogEventType } from "../../../analytics.js";
import { getCodexHistory } from "../queries/history.js";
import { streams } from "@desci-labs/desci-codex-lib";

const logger = parentLogger.child({ module: "api/v2/queries/dpids" });

/** Timeout for individual DPID lookups in milliseconds (3 seconds) */
const DPID_LOOKUP_TIMEOUT_MS = 3_000;

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within the timeout,
 * it returns null instead of blocking indefinitely.
 */
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, dpidNumber: number): Promise<T | null> => {
    return Promise.race([
        promise,
        new Promise<null>((resolve) => {
            setTimeout(() => {
                logger.warn({ dpidNumber, timeoutMs }, "DPID lookup timed out, skipping this dpid to avoid blocking the batch");
                resolve(null);
            }, timeoutMs);
        }),
    ]);
};

/**
 * Helper function to build URL query parameters for pagination
 */
const buildUrlParams = (options: {
    sort?: string;
    includeHistory?: boolean;
    includeMetadata?: boolean;
    fields?: string;
}) => {
    const { sort, includeHistory, includeMetadata, fields } = options;

    const sortParam = sort !== "desc" ? "" : "&sort=desc";
    const historyParam = includeHistory ? "&history=true" : "";
    const metadataParam = includeMetadata ? "&metadata=true" : "";
    const fieldsParam = includeMetadata && fields ? `&fields=${fields}` : "";

    return { sortParam, historyParam, metadataParam, fieldsParam };
};

/**
 * Helper function to build pagination URLs
 */
const buildPaginationUrl = (
    baseUrl: string,
    page: number,
    size: number,
    params: { sortParam: string; historyParam: string; metadataParam: string; fieldsParam: string },
) => {
    const { sortParam, historyParam, metadataParam, fieldsParam } = params;
    return `${baseUrl}?page=${page}&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`;
};

/**
 * Helper function to build special pagination URLs (withHistory, withoutHistory, etc.)
 */
const buildSpecialPaginationUrl = (
    baseUrl: string,
    page: number,
    size: number,
    sort: string,
    type: "withHistory" | "withoutHistory" | "withMetadata" | "withoutMetadata",
    metadataFields: string[],
    currentMetadata?: boolean,
    currentFields?: string,
) => {
    const sortParam = sort !== "desc" ? "" : "&sort=desc";

    switch (type) {
        case "withHistory": {
            const metadataParamForHistory = currentMetadata ? "&metadata=true" : "";
            const fieldsParamForHistory = currentMetadata && currentFields ? `&fields=${currentFields}` : "";
            return `${baseUrl}?page=${page}&size=${size}${sortParam}&history=true${metadataParamForHistory}${fieldsParamForHistory}`;
        }
        case "withoutHistory": {
            const metadataParamForNoHistory = currentMetadata ? "&metadata=true" : "";
            const fieldsParamForNoHistory = currentMetadata && currentFields ? `&fields=${currentFields}` : "";
            return `${baseUrl}?page=${page}&size=${size}${sortParam}${metadataParamForNoHistory}${fieldsParamForNoHistory}`;
        }
        case "withMetadata": {
            const historyParamForMetadata = currentMetadata ? "&history=true" : "";
            return `${baseUrl}?page=${page}&size=${size}${sortParam}${historyParamForMetadata}&metadata=true&fields=${metadataFields.join(",")}`;
        }
        case "withoutMetadata": {
            const historyParamForNoMetadata = currentMetadata ? "&history=true" : "";
            return `${baseUrl}?page=${page}&size=${size}${sortParam}${historyParamForNoMetadata}`;
        }
        default:
            return `${baseUrl}?page=${page}&size=${size}${sortParam}`;
    }
};

// TypeScript type definitions - defined before usage
export type ManifestMetadata = {
    title?: string;
    description?: string;
    authors?: Array<{
        name?: string;
        orcid?: string;
    }>;
    keywords?: string[];
    license?: string;
    [key: string]: unknown; // Allow additional metadata fields
};

// Internal interfaces for type safety
interface ManifestData {
    title?: string;
    description?: string;
    authors?: Array<{
        name?: string;
        orcid?: string;
        [key: string]: unknown;
    }>;
    keywords?: string[];
    license?: string;
    [key: string]: unknown; // Allow additional metadata fields
}

interface VersionData {
    index: number;
    cid: string;
    time: number | undefined;
}

interface LegacyVersionEntry {
    0: string; // CID
    1: { toNumber?: () => number } | number; // timestamp
    [key: string]: unknown;
}

/**
 * Fetch and parse manifest metadata from IPFS
 */
const fetchManifestMetadata = async (
    cid: string,
    fields: string[] = ["title", "authors", "description", "keywords", "license"],
): Promise<ManifestMetadata | null> => {
    if (!cid || cid === "") return null;

    const startTime = Date.now();
    try {
        // Use AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        // Use the same IPFS gateway as the resolver
        const ipfsUrl = `https://ipfs.desci.com/ipfs/${cid}`;
        const response = await fetch(ipfsUrl, {
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            logger.warn({ cid, status: response.status }, "Failed to fetch manifest from IPFS");
            return null;
        }

        const manifest = (await response.json()) as ManifestData;
        const fetchTime = Date.now() - startTime;

        // Extract only the requested metadata fields
        const metadata: ManifestMetadata = {};

        if (fields.includes("title") && manifest.title) {
            metadata.title = manifest.title;
        }
        if (fields.includes("description") && manifest.description) {
            metadata.description = manifest.description;
        }
        if (fields.includes("license") && manifest.license) {
            metadata.license = manifest.license;
        }
        if (fields.includes("keywords") && manifest.keywords && Array.isArray(manifest.keywords)) {
            metadata.keywords = manifest.keywords;
        }

        // Extract authors from various possible formats
        if (fields.includes("authors") && manifest.authors && Array.isArray(manifest.authors)) {
            metadata.authors = manifest.authors
                .map((author) => {
                    const authorData: { name?: string; orcid?: string } = {};
                    if (author.name) authorData.name = author.name;
                    if (author.orcid) authorData.orcid = author.orcid;
                    return authorData;
                })
                .filter((author: { name?: string; orcid?: string }) => author.name || author.orcid);
        }

        logger.info(
            { cid, fetchTime, fieldsRequested: fields, fieldsFound: Object.keys(metadata) },
            "Fetched manifest metadata",
        );
        return metadata;
    } catch (e) {
        const fetchTime = Date.now() - startTime;
        if ((e as Error).name === "AbortError") {
            logger.warn({ cid, fetchTime }, "Manifest fetch timed out");
        } else {
            logger.warn({ cid, fetchTime, error: (e as Error).message }, "Failed to parse manifest metadata");
        }
        return null;
    }
};

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
 * Lightweight DPID info lookup - only gets essential data without full history
 */
const getLightweightDpidInfo = async (
    dpidNumber: number,
    includeHistory: boolean = false,
    includeMetadata: boolean = false,
    metadataFields: string[] = ["title", "authors"],
) => {
    const startTime = Date.now();
    try {
        // First check if it has a Ceramic streamId
        const registryStart = Date.now();
        const streamId = await dpidAliasRegistry.registry(dpidNumber);
        const registryTime = Date.now() - registryStart;

        if (streamId && streamId !== "") {
            // Ceramic DPID
            if (includeHistory) {
                // Full history fetch (slower)
                try {
                    const historyStart = Date.now();
                    const history = await getCodexHistory(streamId);
                    const historyTime = Date.now() - historyStart;

                    let metadata: ManifestMetadata | undefined;
                    let metadataTime = 0;

                    if (includeMetadata) {
                        const metadataStart = Date.now();
                        metadata = (await fetchManifestMetadata(history.manifest, metadataFields)) || undefined;
                        metadataTime = Date.now() - metadataStart;
                    }

                    const totalTime = Date.now() - startTime;
                    // Extract latest timestamp from the most recent version
                    // Normalize undefined/null to undefined for consistent API response
                    const latestVersion = history.versions[history.versions.length - 1];
                    const latestTimestamp = latestVersion?.time ?? undefined;

                    logger.info(
                        {
                            dpidNumber,
                            registryTime,
                            historyTime,
                            metadataTime,
                            totalTime,
                            versionCount: history.versions.length,
                            latestTimestamp,
                            includeHistory,
                            includeMetadata,
                            metadataFields: includeMetadata ? metadataFields : undefined,
                        },
                        "Ceramic DPID timing (with history)",
                    );

                    return {
                        dpid: dpidNumber,
                        owner: history.owner,
                        latestCid: history.manifest,
                        versionCount: history.versions.length,
                        source: "ceramic" as const,
                        streamId,
                        latestTimestamp,
                        metadata,
                        // Include full version info
                        versions: history.versions.map((v, index: number) => ({
                            index,
                            cid: v.manifest,
                            time: v.time ?? undefined,
                        })),
                    };
                } catch (e) {
                    const totalTime = Date.now() - startTime;
                    logger.warn(
                        {
                            dpidNumber,
                            streamId,
                            totalTime,
                            includeHistory,
                            includeMetadata,
                            error: (e as Error).message,
                        },
                        "Failed to fetch Ceramic history",
                    );
                    return null;
                }
            } else {
                // Basic info only (much faster)
                try {
                    const ceramic = getCeramicClient();
                    const historyStart = Date.now();

                    // Just load the stream for basic info, don't fetch full history
                    const streamID = streams.StreamID.fromString(streamId);
                    const stream = await ceramic.loadStream(streamID);

                    const historyTime = Date.now() - historyStart;

                    let metadata: ManifestMetadata | undefined;
                    let metadataTime = 0;

                    if (includeMetadata) {
                        const metadataStart = Date.now();
                        metadata =
                            (await fetchManifestMetadata(stream.content.manifest as string, metadataFields)) ||
                            undefined;
                        metadataTime = Date.now() - metadataStart;
                    }

                    const totalTime = Date.now() - startTime;

                    // Get basic version count from log without processing each commit
                    const commitCount = stream.state.log.filter(({ type }) => type !== 2).length;

                    // Get the latest timestamp from the most recent log entry
                    // We look for the last log entry with a timestamp (anchored commits have timestamps)
                    const latestLogEntry = stream.state.log
                        .slice()
                        .reverse()
                        .find((entry) => entry.timestamp !== undefined && entry.timestamp !== null);
                    // Normalize undefined/null to undefined for consistent API response
                    const latestTimestamp = latestLogEntry?.timestamp ?? undefined;

                    logger.info(
                        {
                            dpidNumber,
                            registryTime,
                            historyTime,
                            metadataTime,
                            totalTime,
                            versionCount: commitCount,
                            latestTimestamp,
                            includeHistory,
                            includeMetadata,
                            metadataFields: includeMetadata ? metadataFields : undefined,
                        },
                        "Ceramic DPID timing (basic info only)",
                    );

                    return {
                        dpid: dpidNumber,
                        owner: (stream.state.metadata.controllers[0] as string).replace(/^did:pkh:eip155:\d+:/, ""),
                        latestCid: stream.content.manifest as string,
                        versionCount: commitCount,
                        source: "ceramic" as const,
                        streamId,
                        latestTimestamp,
                        metadata,
                        // No detailed version info when history=false
                        versions: [],
                    };
                } catch (e) {
                    const totalTime = Date.now() - startTime;
                    logger.warn(
                        {
                            dpidNumber,
                            streamId,
                            totalTime,
                            includeHistory,
                            includeMetadata,
                            error: (e as Error).message,
                        },
                        "Failed to fetch basic Ceramic info",
                    );
                    return null;
                }
            }
        } else {
            // Legacy DPID - get from contract
            try {
                const legacyStart = Date.now();
                const legacyEntry = await dpidAliasRegistry.legacyLookup(dpidNumber);
                const legacyTime = Date.now() - legacyStart;

                const owner = legacyEntry[0];
                const versions = legacyEntry[1] || [];

                if (!owner || versions.length === 0) {
                    const totalTime = Date.now() - startTime;
                    logger.warn(
                        { dpidNumber, totalTime, legacyTime, includeHistory, includeMetadata },
                        "Legacy DPID has no data",
                    );
                    return null;
                }

                const latestCid = versions[versions.length - 1]?.[0] || "";

                // Extract latest timestamp from the most recent version
                // Normalize undefined/null to undefined for consistent API response
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
                    metadata = (await fetchManifestMetadata(latestCid, metadataFields)) || undefined;
                    metadataTime = Date.now() - metadataStart;
                }

                const totalTime = Date.now() - startTime;
                logger.info(
                    {
                        dpidNumber,
                        registryTime,
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
                    "Failed to fetch legacy info",
                );
                return null;
            }
        }
    } catch (e) {
        const totalTime = Date.now() - startTime;
        logger.warn(
            { dpidNumber, totalTime, includeHistory, includeMetadata, error: (e as Error).message },
            "Failed to check DPID registry",
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
        // Step 1: Get total DPID count (fast contract call)
        const nextDpidBigNumber = await dpidAliasRegistry.nextDpid();
        const nextDpid = nextDpidBigNumber.toNumber();
        const totalDpids = Math.max(0, nextDpid - 1);

        if (totalDpids === 0) {
            const paginationBaseUrl = `${req.protocol}://${req.get("host")}/api/v2/query/dpids`;
            const urlParams = buildUrlParams({
                sort,
                includeHistory,
                includeMetadata,
                fields: req.query.fields,
            });

            return res.json({
                dpids: [],
                pagination: {
                    page,
                    size,
                    total: 0,
                    hasNext: false,
                    hasPrev: false,
                    links: {
                        self: buildPaginationUrl(paginationBaseUrl, page, size, urlParams),
                        first: buildPaginationUrl(paginationBaseUrl, 1, size, urlParams),
                        prev: null,
                        next: null,
                        last: buildPaginationUrl(paginationBaseUrl, 1, size, urlParams),
                        withHistory: includeHistory
                            ? null
                            : buildSpecialPaginationUrl(
                                  paginationBaseUrl,
                                  page,
                                  size,
                                  sort,
                                  "withHistory",
                                  metadataFields,
                                  includeMetadata,
                                  req.query.fields,
                              ),
                        withoutHistory: includeHistory
                            ? buildSpecialPaginationUrl(
                                  paginationBaseUrl,
                                  page,
                                  size,
                                  sort,
                                  "withoutHistory",
                                  metadataFields,
                                  includeMetadata,
                                  req.query.fields,
                              )
                            : null,
                        withMetadata: includeMetadata
                            ? null
                            : buildSpecialPaginationUrl(
                                  paginationBaseUrl,
                                  page,
                                  size,
                                  sort,
                                  "withMetadata",
                                  metadataFields,
                                  includeHistory,
                                  undefined,
                              ),
                        withoutMetadata: includeMetadata
                            ? buildSpecialPaginationUrl(
                                  paginationBaseUrl,
                                  page,
                                  size,
                                  sort,
                                  "withoutMetadata",
                                  metadataFields,
                                  includeHistory,
                                  undefined,
                              )
                            : null,
                    },
                },
            });
        }

        // Step 2: Calculate pagination
        const startDpid =
            sort === "desc" ? Math.max(1, totalDpids - (page - 1) * size - size + 1) : (page - 1) * size + 1;

        const endDpid =
            sort === "desc" ? Math.max(1, totalDpids - (page - 1) * size) : Math.min(totalDpids, startDpid + size - 1);

        // Step 3: Generate DPID numbers for this page
        const dpidNumbers: number[] = [];
        if (sort === "desc") {
            for (let i = endDpid; i >= startDpid; i--) {
                dpidNumbers.push(i);
            }
        } else {
            for (let i = startDpid; i <= endDpid; i++) {
                dpidNumbers.push(i);
            }
        }

        // Step 4: Batch fetch lightweight DPID info with timeout protection
        // Each dpid has a timeout to prevent one slow/broken dpid from blocking the entire batch
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const batchStart = Date.now();
        logger.info(
            { dpidCount: dpidNumbers.length, timeoutMs: DPID_LOOKUP_TIMEOUT_MS },
            "Fetching lightweight DPID info in parallel with timeout protection",
        );

        const dpidPromises = dpidNumbers.map((dpidNumber) =>
            withTimeout(
                getLightweightDpidInfo(dpidNumber, includeHistory, includeMetadata, metadataFields),
                DPID_LOOKUP_TIMEOUT_MS,
                dpidNumber,
            ),
        );

        const dpidInfos = await Promise.all(dpidPromises);
        const batchTime = Date.now() - batchStart;

        // Count how many dpids timed out
        const timedOutCount = dpidInfos.filter((info) => info === null).length;
        const successCount = dpidInfos.filter((info) => info !== null).length;

        logger.info(
            {
                dpidCount: dpidNumbers.length,
                successCount,
                timedOutCount,
                batchTime,
                avgTimePerDpid: Math.round(batchTime / dpidNumbers.length),
            },
            "Batch DPID lookup completed",
        );

        // Step 5: Transform to API format
        const resolvedDpids = dpidInfos
            .filter((info): info is NonNullable<typeof info> => info !== null)
            .map((info) => {
                // Normalize latestTimestamp: ensure undefined/null becomes undefined
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

                // Conditionally include versions field only when history is requested
                if (includeHistory && info.versions.length > 0) {
                    result.versions = info.versions.map((v: VersionData) => ({
                        index: v.index,
                        cid: v.cid,
                        time: v.time,
                        resolveUrl: `${baseUrl}/api/v2/resolve/dpid/${info.dpid}/v${v.index + 1}`,
                    }));
                }

                // Conditionally include metadata field only when metadata is requested
                if (includeMetadata && info.metadata) {
                    result.metadata = info.metadata;
                }

                return result;
            });

        // Step 6: Build response with pagination
        const hasNext = sort === "desc" ? startDpid > 1 : endDpid < totalDpids;
        const hasPrev = page > 1;

        // Build pagination links with history parameter
        const paginationBaseUrl = `${req.protocol}://${req.get("host")}/api/v2/query/dpids`;
        const urlParams = buildUrlParams({
            sort,
            includeHistory,
            includeMetadata,
            fields: req.query.fields,
        });
        const lastPage = Math.ceil(totalDpids / size);

        return res.json({
            dpids: resolvedDpids,
            pagination: {
                page,
                size,
                total: totalDpids,
                hasNext,
                hasPrev,
                links: {
                    self: buildPaginationUrl(paginationBaseUrl, page, size, urlParams),
                    first: buildPaginationUrl(paginationBaseUrl, 1, size, urlParams),
                    prev: hasPrev ? buildPaginationUrl(paginationBaseUrl, page - 1, size, urlParams) : null,
                    next: hasNext ? buildPaginationUrl(paginationBaseUrl, page + 1, size, urlParams) : null,
                    last: buildPaginationUrl(paginationBaseUrl, lastPage, size, urlParams),
                    // Self-documenting: show both history options
                    withHistory: includeHistory
                        ? null
                        : buildSpecialPaginationUrl(
                              paginationBaseUrl,
                              page,
                              size,
                              sort,
                              "withHistory",
                              metadataFields,
                              includeMetadata,
                              req.query.fields,
                          ),
                    withoutHistory: includeHistory
                        ? buildSpecialPaginationUrl(
                              paginationBaseUrl,
                              page,
                              size,
                              sort,
                              "withoutHistory",
                              metadataFields,
                              includeMetadata,
                              req.query.fields,
                          )
                        : null,
                    withMetadata: includeMetadata
                        ? null
                        : buildSpecialPaginationUrl(
                              paginationBaseUrl,
                              page,
                              size,
                              sort,
                              "withMetadata",
                              metadataFields,
                          ),
                    withoutMetadata: includeMetadata
                        ? buildSpecialPaginationUrl(
                              paginationBaseUrl,
                              page,
                              size,
                              sort,
                              "withoutMetadata",
                              metadataFields,
                          )
                        : null,
                },
            },
        });
    } catch (err) {
        const error = err as Error;
        logger.error("Error fetching DPIDs", error.message);
        return res.status(500).json({
            error: "Failed to fetch DPIDs",
            details: error.message,
        });
    }
};
