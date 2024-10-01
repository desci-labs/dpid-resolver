import type { Request, Response } from "express";
import { CACHE_TTL_ANCHORED, CACHE_TTL_PENDING, DPID_ENV, getCeramicClient } from "../../../util/config.js";
import { type CeramicClient } from "@desci-labs/desci-codex-lib";
import parentLogger, { serializeError } from "../../../logger.js";
import { DpidResolverError, resolveDpid } from "../resolvers/dpid.js";
import { isDpid } from "../../../util/validation.js";
import { CommitID, StreamID } from "@desci-labs/desci-codex-lib/dist/streams.js";
import { getFromCache, keyBump, setToCache } from "../../../redis.js";
import { cleanupEip155Address } from "../../../util/conversions.js";

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
    const dpids = ids.filter(isDpid).map(parseInt);
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
            return res.status(500).send(errPayload);
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

    const historyPromises = streamIds.map((id) => getCodexHistory(id));

    const result = await Promise.all(historyPromises);
    return result;
};

const loadOpts = {
    sync: 0, // PREFER_CACHE
    syncTimeoutSeconds: 3,
};

const getKeyForCommit = (commit: CommitID) => `resolver-${DPID_ENV}-commit-${commit.toString()}`;

export const getCodexHistory = async (streamId: string) => {
    const ceramic = getCeramicClient();
    const streamID = StreamID.fromString(streamId);
    const stream = await ceramic.loadStream(streamID);
    const commitIds = stream.state.log.filter(({ type }) => type !== 2).map(({ cid }) => CommitID.make(streamID, cid));

    const versionPromises = commitIds.map(async (commit) => {
        const key = getKeyForCommit(commit);
        const cached = await getFromCache<HistoryVersion>(key);
        if (cached !== null) {
            // Only refresh TTL if entry is anchored, otherwise we'll postpone refreshes
            if (cached.time) keyBump(key, CACHE_TTL_ANCHORED);
            return cached;
        }
        const fresh = await getFreshVersionInfo(ceramic, commit);
        const cacheTtl = fresh.time ? CACHE_TTL_ANCHORED : CACHE_TTL_PENDING;
        setToCache(key, fresh, cacheTtl);
        return fresh;
    });

    const versions = await Promise.all(versionPromises);

    return {
        id: streamId,
        // Convert fully qualified EIP155 address to plain hex
        owner: cleanupEip155Address(stream.state.metadata.controllers[0]),
        // Latest manifest CID
        manifest: stream.content.manifest as string,
        versions,
    };
};

const getFreshVersionInfo = async (ceramic: CeramicClient, commit: CommitID): Promise<HistoryVersion> => {
    const stream = await ceramic.loadStream(commit, loadOpts);

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
