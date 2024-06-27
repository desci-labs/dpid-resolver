import type { Request, Response } from "express";
import { getCeramicClient } from "../../../util/config.js";
import { resolveHistory, type CeramicClient } from "@desci-labs/desci-codex-lib";

export type HistoryQueryRequest = {
    streamIds?: string[];
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
    /** Owner DID in format did:pkh:eip155:1337:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 */
    owner: string;
    /** Most recent manifest CID */
    manifest: string;
    /** Research object title */
    versions: HistoryVersion[];
};

export type HistoryQueryError = string;

/**
 * For one or more streamIDs, fetch metadata and version history
 */
export const historyQueryHandler = async (
    req: Request<unknown, unknown, HistoryQueryRequest>,
    res: Response<HistoryQueryResponse>,
): Promise<typeof res> => {
    const { streamIds } = req.body;

    if (!Array.isArray(streamIds)) {
        return res.status(400).send("Missing streamIds array in body");
    }

    const ceramic = getCeramicClient();

    const streamQueries = streamIds.map((streamId) => ({ streamId }));
    const streams = await ceramic.multiQuery(streamQueries);

    /** Stream info but missing historical versions */
    const result: HistoryQueryResult[] = await Promise.all(
        Object.entries(streams).map(async ([streamId, stream]) => ({
            id: streamId,
            owner: stream.state.metadata.controllers[0],
            manifest: stream.content.manifest as string,
            versions: await getVersions(ceramic, streamId),
        })),
    );

    return res.send(result);
};

const getVersions = async (ceramic: CeramicClient, streamId: string) => {
    const log = await resolveHistory(ceramic, streamId);
    const states = await ceramic.multiQuery(log.map((l) => ({ streamId: l.commit.toString() })));

    // Join log info with manifest from actual version state
    return log.map((l) => ({
        version: l.commit.toString(),
        time: l.timestamp,
        manifest: states[l.commit.toString()].content.manifest as string,
    }));
};
