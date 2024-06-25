import type { Request, Response } from "express";
import parentLogger from "../../../logger.js";
import { newCeramicClient, pidFromStringID, resolveState } from "@desci-labs/desci-codex-lib";

const CERAMIC_URL = process.env.CERAMIC_URL;
const MODULE_PATH = "/api/v2/resolvers/codex" as const;

const logger = parentLogger.child({
    module: MODULE_PATH,
    ceramicApi: CERAMIC_URL,
});

const getCeramicClient = () => {
    if (!CERAMIC_URL) throw new Error("CERAMIC_URL not set");
    return newCeramicClient(CERAMIC_URL);
};

export type ResolveCodexParams = {
    streamId: string;
    versionIx?: number;
};

export type ResolveCodexResponse =
    // TODO composeDB model query => get stream history?
    // Otherwise, this could really be anything
    | ManifestCidThing
    | {
          error: string;
          details: any;
          params: ResolveCodexParams;
          path: typeof MODULE_PATH;
      };

/**
 * Resolve a streamID (root node), commitID (specific version),
 * or version index of a root node.
 *
 * @returns response with the stream state
 * @throws if id is an invalid stream or commit ID
 */
export const resolveCodexHandler = async (
    req: Request<ResolveCodexParams>,
    res: Response<ResolveCodexResponse>,
): Promise<typeof res> => {
    logger.info({ ...req.params }, `resolving codex entity with ${CERAMIC_URL}`);

    const { streamId, versionIx } = req.params;

    let result: ManifestCidThing;
    try {
        result = await resolveCodex(streamId, versionIx);
    } catch (e) {
        const err = e as Error;
        if (err.message.includes("ambiguous reference")) {
            // Request does not make sense, refusing to make assumptions
            return res.status(400).send({
                error: "Ambiguous reference",
                details: "Send one combination of [(id: streamID), (id: commitID), (id: streamID, versionIx: integer)]",
                params: req.params,
                path: MODULE_PATH,
            });
        } else {
            // TODO filter error for stream not found from technical issues
            logger.error({ streamId, versionIx, err }, "failed to resolve stream");
            return res.status(404).send({
                error: "Could not resolve",
                details: err,
                params: req.params,
                path: MODULE_PATH,
            });
        }
    }

    return res.status(200).send(result);
};

/** TODO lookup by model to ensure shape, this is a bit dirty */
export type ManifestCidThing = { manifest: string };

export const resolveCodex = async (streamId: string, versionIx: number | undefined): Promise<ManifestCidThing> => {
    const client = getCeramicClient();

    // Wrapper for StreamID or CommitID, throws if id is invalid stream/commit
    const codexPid = pidFromStringID(streamId);

    let result: { manifest: string } | undefined;
    if (codexPid.tag === "root" && versionIx === undefined) {
        // Request makes sense as newest state resolution
        result = (await resolveState(client, codexPid)) as ManifestCidThing;
    } else if (codexPid.tag === "root" && versionIx !== undefined) {
        // Request makes sense as numerical index resolution
        result = (await resolveState(client, {
            tag: "indexed",
            id: codexPid.id,
            versionIx,
        })) as ManifestCidThing;
    } else if (codexPid.tag === "versioned" && versionIx === undefined) {
        // Request makes sense as specific version resolution
        result = (await resolveState(client, codexPid)) as ManifestCidThing;
    } else {
        throw new Error("ambiguous reference");
    }

    return result;
};
