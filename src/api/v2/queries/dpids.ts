import type { Request, Response } from "express";
import { getDpidAliasRegistry, getCeramicClient } from "../../../util/config.js";
import parentLogger from "../../../logger.js";
import analytics, { LogEventType } from "../../../analytics.js";
import { getCodexHistory } from "../queries/history.js";
import type { DpidAliasRegistry } from "@desci-labs/desci-contracts/dist/typechain-types/DpidAliasRegistry.js";

const logger = parentLogger.child({ module: "api/v2/queries/dpids" });

// TypeScript interfaces to replace any types
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

export type DpidQueryResult = {
    dpid: number;
    owner: string;
    latestCid: string;
    versionCount: number;
    source: "ceramic" | "legacy";
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
    registry: DpidAliasRegistry,
    includeHistory: boolean = false,
    includeMetadata: boolean = false,
    metadataFields: string[] = ["title", "authors"],
) => {
    const startTime = Date.now();
    try {
        // First check if it has a Ceramic streamId
        const registryStart = Date.now();
        const streamId = await registry.registry(dpidNumber);
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
                    logger.info(
                        {
                            dpidNumber,
                            registryTime,
                            historyTime,
                            metadataTime,
                            totalTime,
                            versionCount: history.versions.length,
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
                        metadata,
                        // Include full version info
                        versions: history.versions.map((v, index: number) => ({
                            index,
                            cid: v.manifest,
                            time: v.time,
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
                    const StreamID = (await import("@desci-labs/desci-codex-lib/dist/streams.js")).StreamID;
                    const streamID = StreamID.fromString(streamId);
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

                    logger.info(
                        {
                            dpidNumber,
                            registryTime,
                            historyTime,
                            metadataTime,
                            totalTime,
                            versionCount: commitCount,
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
                const legacyEntry = await registry.legacyLookup(dpidNumber);
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
                    metadata,
                    versions: includeHistory
                        ? versions.map((v, index: number) => ({
                              index,
                              cid: v.cid || (v as unknown as LegacyVersionEntry)[0],
                              time: v.time?.toNumber
                                  ? v.time.toNumber()
                                  : ((v as unknown as LegacyVersionEntry)[1] as number),
                          }))
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
        const registry = getDpidAliasRegistry();

        // Step 1: Get total DPID count (fast contract call)
        const nextDpidBigNumber = await registry.nextDpid();
        const nextDpid = nextDpidBigNumber.toNumber();
        const totalDpids = Math.max(0, nextDpid - 1);

        if (totalDpids === 0) {
            const paginationBaseUrl = `${req.protocol}://${req.get("host")}/api/v2/query/dpids`;
            const sortParam = sort !== "desc" ? "" : "&sort=desc";
            const historyParam = includeHistory ? "&history=true" : "";
            const metadataParam = includeMetadata ? "&metadata=true" : "";
            const fieldsParam = includeMetadata && req.query.fields ? `&fields=${req.query.fields}` : "";

            return res.json({
                dpids: [],
                pagination: {
                    page,
                    size,
                    total: 0,
                    hasNext: false,
                    hasPrev: false,
                    links: {
                        self: `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`,
                        first: `${paginationBaseUrl}?page=1&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`,
                        prev: null,
                        next: null,
                        last: `${paginationBaseUrl}?page=1&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`,
                        withHistory: includeHistory
                            ? null
                            : `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}&history=true${metadataParam}${fieldsParam}`,
                        withoutHistory: includeHistory
                            ? `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${metadataParam}${fieldsParam}`
                            : null,
                        withMetadata: includeMetadata
                            ? null
                            : `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${historyParam}&metadata=true&fields=${metadataFields.join(",")}`,
                        withoutMetadata: includeMetadata
                            ? `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${historyParam}`
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

        // Step 4: Batch fetch lightweight DPID info (much faster!)
        const baseUrl = `${req.protocol}://${req.get("host")}`;
        const batchStart = Date.now();
        logger.info({ dpidCount: dpidNumbers.length }, "Fetching lightweight DPID info in parallel");

        const dpidPromises = dpidNumbers.map((dpidNumber) =>
            getLightweightDpidInfo(dpidNumber, registry, includeHistory, includeMetadata, metadataFields),
        );

        const dpidInfos = await Promise.all(dpidPromises);
        const batchTime = Date.now() - batchStart;

        logger.info(
            {
                dpidCount: dpidNumbers.length,
                batchTime,
                avgTimePerDpid: Math.round(batchTime / dpidNumbers.length),
            },
            "Batch DPID lookup completed",
        );

        // Step 5: Transform to API format
        const resolvedDpids = dpidInfos
            .filter((info): info is NonNullable<typeof info> => info !== null)
            .map((info) => {
                const baseResult = {
                    dpid: info.dpid,
                    owner: info.owner,
                    latestCid: info.latestCid,
                    versionCount: info.versionCount,
                    source: info.source,
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
        const sortParam = sort !== "desc" ? "" : "&sort=desc";
        const historyParam = includeHistory ? "&history=true" : "";
        const metadataParam = includeMetadata ? "&metadata=true" : "";
        const fieldsParam = includeMetadata && req.query.fields ? `&fields=${req.query.fields}` : "";
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
                    self: `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`,
                    first: `${paginationBaseUrl}?page=1&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`,
                    prev: hasPrev
                        ? `${paginationBaseUrl}?page=${page - 1}&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`
                        : null,
                    next: hasNext
                        ? `${paginationBaseUrl}?page=${page + 1}&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`
                        : null,
                    last: `${paginationBaseUrl}?page=${lastPage}&size=${size}${sortParam}${historyParam}${metadataParam}${fieldsParam}`,
                    // Self-documenting: show both history options
                    withHistory: includeHistory
                        ? null
                        : `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}&history=true${metadataParam}${fieldsParam}`,
                    withoutHistory: includeHistory
                        ? `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${metadataParam}${fieldsParam}`
                        : null,
                    withMetadata: includeMetadata
                        ? null
                        : `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${historyParam}&metadata=true&fields=${metadataFields.join(",")}`,
                    withoutMetadata: includeMetadata
                        ? `${paginationBaseUrl}?page=${page}&size=${size}${sortParam}${historyParam}`
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
