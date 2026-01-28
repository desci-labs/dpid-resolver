import type { Request, Response } from "express";
import { CACHE_TTL_ANCHORED, CACHE_TTL_PENDING, DPID_ENV, getCeramicClient } from "../../../util/config.js";
import { type CeramicClient } from "@desci-labs/desci-codex-lib";
import parentLogger, { serializeError } from "../../../logger.js";
import { DpidResolverError, resolveDpid } from "../resolvers/dpid.js";
import { isDpid } from "../../../util/validation.js";
import { streams } from "@desci-labs/desci-codex-lib";
import { flightClient } from "../../../flight.js";
import { redisService } from "../../../redis.js";
import { cleanupEip155Address } from "../../../util/conversions.js";
import { getStreamHistory, getStreamHistoryMultiple } from "@desci-labs/desci-codex-lib/c1/resolve";
import { StreamID } from "@ceramic-sdk/identifiers";
import { tableFromIPC } from "apache-arrow";

const MODULE_PATH = "api/v2/queries/history" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

export type HistoryQueryRequest = {
    /** Body with multiple IDs */
    ids?: string[];
};

export type HistoryQueryParams = {
    /** Single ID can be passed as query param */
    id?: string;
};

export type ErrorResponse = {
    error: string;
    details: unknown;
    body: unknown;
    params: unknown;
    path: typeof MODULE_PATH;
};

export type HistoryQueryResponse = HistoryQueryResult[] | ErrorResponse;

export type HistoryVersion = {
    /** Manifest CID at this version */
    manifest: string;
    /** Commit ID at this version */
    version: string;
    /** Anchor timestamp at this version, undefined if not yet anchored */
    time: number | undefined;
};

export type HistoryQueryResult = {
    /** Stream ID */
    id: string;
    /** Owner DID address, e.g. 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 */
    owner: string;
    /** Most recent manifest CID */
    manifest: string;
    /** Research object title */
    versions: HistoryVersion[];
};

/**
 * Lightweight result for basic stream info (no full version history)
 */
export type BasicStreamInfo = {
    /** Stream ID */
    id: string;
    /** Owner address (hex format) */
    owner: string;
    /** Latest manifest CID */
    manifest: string;
    /** Number of versions */
    versionCount: number;
    /** Timestamp of latest anchored event */
    latestTimestamp: number | undefined;
};

/**
 * SQL query to get the latest state AND version count for multiple streams in ONE query.
 * Uses a window function to get the latest state per stream and counts non-anchor events.
 */
const batchLatestStreamStateQuery = (streamIds: StreamID[]) => `
  WITH latest_states AS (
    SELECT DISTINCT ON (stream_cid)
      controller,
      cid_string(stream_cid) as stream_cid,
      data::varchar->>'content' as state,
      before
    FROM event_states
    WHERE cid_string(stream_cid) = ANY(ARRAY[${streamIds.map((id) => `'${id.cid.toString()}'`).join(",")}])
    ORDER BY stream_cid, event_height DESC
  ),
  version_counts AS (
    SELECT 
      cid_string(stream_cid) as stream_cid,
      COUNT(*) as version_count
    FROM event_states
    WHERE cid_string(stream_cid) = ANY(ARRAY[${streamIds.map((id) => `'${id.cid.toString()}'`).join(",")}])
      AND event_type != 2
    GROUP BY stream_cid
  )
  SELECT 
    ls.controller,
    ls.stream_cid,
    ls.state,
    ls.before,
    COALESCE(vc.version_count, 1) as version_count
  FROM latest_states ls
  LEFT JOIN version_counts vc ON ls.stream_cid = vc.stream_cid;
`;

/**
 * Get basic stream info for multiple streams in ONE query.
 * Much more efficient than calling getBasicStreamInfo for each stream.
 *
 * @param streamIds - Array of stream ID strings
 * @returns Map of streamId to BasicStreamInfo
 */
export const getBasicStreamInfoBatch = async (streamIds: string[]): Promise<Map<string, BasicStreamInfo>> => {
    const results = new Map<string, BasicStreamInfo>();
    
    if (!flightClient) {
        logger.warn("flightClient not available for getBasicStreamInfoBatch");
        return results;
    }

    if (streamIds.length === 0) {
        return results;
    }

    const startTime = Date.now();
    try {
        const streams = streamIds.map((id) => StreamID.fromString(id));
        const queryResult = await flightClient.query(batchLatestStreamStateQuery(streams));
        const table = tableFromIPC(queryResult);
        const rows = table.toArray();

        for (const row of rows) {
            try {
                const state = JSON.parse(row.state);
                const streamCid = row.stream_cid;
                // Find the original streamId that matches this CID
                const matchingStreamId = streamIds.find((id) => {
                    const sid = StreamID.fromString(id);
                    return sid.cid.toString() === streamCid;
                });

                if (matchingStreamId) {
                    // Convert BigInt values to Numbers for JSON serialization
                    const versionCount = typeof row.version_count === 'bigint' 
                        ? Number(row.version_count) 
                        : Number(row.version_count);
                    const latestTimestamp = row.before != null 
                        ? (typeof row.before === 'bigint' ? Number(row.before) : Number(row.before))
                        : undefined;
                    
                    results.set(matchingStreamId, {
                        id: matchingStreamId,
                        owner: cleanupEip155Address(row.controller),
                        manifest: state.manifest,
                        versionCount,
                        latestTimestamp,
                    });
                }
            } catch (parseError) {
                logger.warn({ row, error: parseError }, "Failed to parse row in batch query");
            }
        }

        const totalTime = Date.now() - startTime;
        logger.info(
            { streamCount: streamIds.length, foundCount: results.size, totalTime },
            "getBasicStreamInfoBatch completed",
        );

        return results;
    } catch (error) {
        const totalTime = Date.now() - startTime;
        logger.warn(
            { streamCount: streamIds.length, totalTime, error: serializeError(error as Error) },
            "getBasicStreamInfoBatch failed",
        );
        return results;
    }
};

/**
 * Get basic stream info using flightClient - lightweight alternative to getCodexHistory.
 * Only fetches the latest state and version count, not the full history.
 * For multiple streams, use getBasicStreamInfoBatch instead.
 *
 * @param streamId - The stream ID string
 * @returns Basic stream info or null if not found
 */
export const getBasicStreamInfo = async (streamId: string): Promise<BasicStreamInfo | null> => {
    const results = await getBasicStreamInfoBatch([streamId]);
    return results.get(streamId) ?? null;
};

/**
 * For one or more IDs, fetch metadata and version history.
 * An ID can be both a streamID and a dPID, but a dPID lookup is a bit slower.
 */
export const historyQueryHandler = async (
    req: Request<HistoryQueryParams, unknown, HistoryQueryRequest, undefined>,
    res: Response<HistoryQueryResponse>,
): Promise<typeof res> => {
    const { id } = req.params;
    const { ids = [] } = req.body;

    const baseError = {
        params: req.params,
        body: req.body,
        path: MODULE_PATH,
    };

    if (!Array.isArray(ids)) {
        // Received ids in body, but not as array
        logger.error(baseError, "received malformed IDs");
        return res.status(400).send({
            error: "invalid request",
            details: "body.ids expects string[]",
            ...baseError,
        });
    }

    if (id) {
        // Either put as sole entry if ids wasn't passed, or append to list
        ids.push(id);
    }

    if (ids.length === 0) {
        // Neither ID format was supplied
        logger.error(baseError, "request missing IDs");
        return res.status(400).send({
            error: "invalid request",
            details: "missing /:id or ids array in body",
            ...baseError,
        });
    }

    logger.info({ ids }, "handling history query");

    // Separate ids into streamIDs and dPIDs and handle both types
    const dpids = ids.filter(isDpid).map((i) => parseInt(i, 10));
    const streamIds = ids.filter((i) => !isDpid(i));

    try {
        const [codexHistories, dpidHistories] = await Promise.all([
            getCodexHistories(streamIds),
            getDpidHistories(dpids),
        ]);
        const result = [...codexHistories, ...dpidHistories];
        return res.send(result);
    } catch (e) {
        if (e instanceof DpidResolverError) {
            const errPayload = {
                error: "failed to resolve dpid",
                details: serializeError(e),
                ...baseError,
            };
            logger.error(errPayload, "failed to resolve dpid");
            // Return 404 for DpidNotFound, 500 for other resolver errors
            const statusCode = e.name === "DpidNotFound" ? 404 : 500;
            return res.status(statusCode).send(errPayload);
        }
        const errPayload = {
            error: "failed to compile histories",
            details: serializeError(e as Error),
            ...baseError,
        };
        logger.error(errPayload, "failed to compile histories");
        return res.status(500).send(errPayload);
    }
};

const getCodexHistories = async (streamIds: string[]): Promise<HistoryQueryResult[]> => {
    if (streamIds.length === 0) return [];

    if (flightClient) {
        try {
            return await getStreamHistoryMultiple(flightClient, streamIds);
        } catch (error) {
            logger.warn(
                { error: serializeError(error as Error), streamIds },
                "flightClient multiple history lookup failed; falling back to ceramic",
            );
            // Fall through to Ceramic-based fallback below
        }
    }

    const historyPromises = streamIds.map((id) => getCodexHistory(id));

    const result = await Promise.all(historyPromises);
    return result;
};

const STREAM_LOAD_OPTS = {
    sync: 0, // PREFER_CACHE
    syncTimeoutSeconds: 3,
};

const getKeyForCommit = (commit: streams.CommitID) => `resolver-${DPID_ENV}-commit-${commit.toString()}`;

export const getCodexHistory = async (streamId: string): Promise<HistoryQueryResult> => {
    const startTime = Date.now();

    if (flightClient) {
        try {
            const result = await getStreamHistory(flightClient, streamId);
            const totalTime = Date.now() - startTime;
            logger.info({ streamId, totalTime, source: "flightClient" }, "getCodexHistory completed");
            return result;
        } catch (error) {
            logger.warn(
                { streamId, error: serializeError(error as Error) },
                "flightClient history lookup failed; falling back to ceramic",
            );
            // Fall through to Ceramic-based fallback below
        }
    }

    // Below is used as fallback if flightClient is not instantiated
    const ceramic = getCeramicClient();
    const loadStreamStart = Date.now();
    const streamID = streams.StreamID.fromString(streamId);
    const stream = await ceramic.loadStream(streamID, STREAM_LOAD_OPTS);
    const loadStreamTime = Date.now() - loadStreamStart;

    const commitIds = stream.state.log
        .filter(({ type }) => type !== 2)
        .map(({ cid }) => streams.CommitID.make(streamID, cid));

    let cacheHits = 0;
    let cacheMisses = 0;
    const versionPromises = commitIds.map(async (commit) => {
        const key = getKeyForCommit(commit);
        if (!redisService) {
            cacheMisses++;
            return await getFreshVersionInfo(ceramic, commit);
        }

        const cached = await redisService.getFromCache<HistoryVersion>(key);
        if (cached !== null) {
            cacheHits++;
            // Only refresh TTL if entry is anchored, otherwise we'll postpone refreshes
            if (cached.time) {
                void redisService.keyBump(key, CACHE_TTL_ANCHORED).catch((error) => {
                    logger.warn({ error, key }, "Failed to bump Redis key TTL");
                });
            }
            return cached;
        }
        cacheMisses++;
        const fresh = await getFreshVersionInfo(ceramic, commit);
        const cacheTtl = fresh.time ? CACHE_TTL_ANCHORED : CACHE_TTL_PENDING;
        void redisService.setToCache(key, fresh, cacheTtl).catch((error) => {
            logger.warn({ error, key }, "Failed to set Redis cache");
        });
        return fresh;
    });

    const versions = await Promise.all(versionPromises);
    const totalTime = Date.now() - startTime;

    logger.info(
        {
            streamId,
            totalTime,
            loadStreamTime,
            commitCount: commitIds.length,
            cacheHits,
            cacheMisses,
            source: "ceramic",
        },
        "getCodexHistory timing breakdown",
    );

    return {
        id: streamId,
        // Convert fully qualified EIP155 address to plain hex
        owner: cleanupEip155Address(stream.state.metadata.controllers[0]),
        // Latest manifest CID
        manifest: stream.content.manifest as string,
        versions,
    };
};

const getFreshVersionInfo = async (ceramic: CeramicClient, commit: streams.CommitID): Promise<HistoryVersion> => {
    const stream = await ceramic.loadStream(commit, STREAM_LOAD_OPTS);

    return {
        version: commit.toString(),
        // When loading a specific commit, the log ends with that commit
        time: stream.state.log.at(-1)?.timestamp,
        manifest: stream.content.manifest as string,
    };
};

const getDpidHistories = async (dpids: number[]) => {
    if (dpids.length === 0) return [];
    return await Promise.all(dpids.map(async (dpid) => await resolveDpid(dpid)));
};
