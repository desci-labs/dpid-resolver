import type { Request, Response } from "express";
import { getCeramicClient } from "../../../util/config.js";
import { resolveHistory, type CeramicClient } from "@desci-labs/desci-codex-lib";
import parentLogger from "../../../logger.js";
import { resolveDpid } from "../resolvers/dpid.js";
import { isDpid } from "../../../util/validation.js";

const logger = parentLogger.child({
    module: "api/v2/queries/history",
});

export type HistoryQueryRequest = {
    /** Body with multiple IDs */
    ids?: string[];
};

export type HistoryQueryParams = {
    /** Single ID can be passed as query param */
    id?: string;
};

export type HistoryQueryResponse = HistoryQueryResult[] | HistoryQueryError;

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

export type HistoryQueryError = string;

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

    if (!Array.isArray(ids)) {
        // Received ids in body, but not as array
        logger.error({ body: req.body, params: req.params }, "Received malformed IDs");
        return res.status(400).send("body.ids expects string[]");
    }

    if (id) {
        // Either put as sole entry if ids wasn't passed, or append to list
        ids.push(id);
    }

    if (ids.length === 0) {
        // Neither ID format was supplied
        logger.error({ body: req.body, params: req.params }, "Request missing IDs");
        return res.status(400).send("Missing /:id or ids array in body");
    } else {
        logger.info({ ids }, "Handling history query");
    }

    // Separate ids into streamIDs and dPIDs and handle both types
    const dpids = ids.filter(isDpid).map(parseInt);
    const streamIds = ids.filter((i) => !isDpid(i));

    const [codexHistories, dpidHistories] = await Promise.all([getCodexHistories(streamIds), getDpidHistories(dpids)]);
    const result = [...codexHistories, ...dpidHistories];

    logger.info({ ids, result }, "History query success");
    return res.send(result);
};

export const getVersions = async (ceramic: CeramicClient, streamId: string) => {
    const log = await resolveHistory(ceramic, streamId);
    const states = await ceramic.multiQuery(log.map((l) => ({ streamId: l.commit.toString() })));

    // Join log info with manifest from actual version state
    return log.map((l) => ({
        version: l.commit.toString(),
        time: l.timestamp,
        manifest: states[l.commit.toString()].content.manifest as string,
    }));
};

const getCodexHistories = async (streamIds: string[]) => {
    if (streamIds.length === 0) return [];

    const ceramic = getCeramicClient();
    const streams = await ceramic.multiQuery(streamIds.map((streamId) => ({ streamId })));

    /** Stream info but missing historical versions */
    const result: HistoryQueryResult[] = await Promise.all(
        Object.entries(streams).map(
            async ([streamId, stream]): Promise<HistoryQueryResult> => ({
                id: streamId,
                owner: stream.state.metadata.controllers[0].replace(/did:pkh:eip155:[0-9]+:/, ""),
                manifest: stream.content.manifest as string,
                versions: await getVersions(ceramic, streamId),
            }),
        ),
    );
    return result;
};

const getDpidHistories = async (dpids: number[]) => {
    if (dpids.length === 0) return [];
    return await Promise.all(dpids.map(async (dpid) => await resolveDpid(dpid)));
};
