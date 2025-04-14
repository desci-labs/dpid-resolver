import type { Request, Response } from "express";
import parentLogger, { serializeError } from "../../../logger.js";
import { pidFromStringID, type PID } from "@desci-labs/desci-codex-lib";
import { getCodexHistory, type HistoryQueryResult } from "../queries/history.js";
import { IPFS_GATEWAY } from "../../../util/config.js";
import { MystTransformer, RoCrateTransformer } from "@desci-labs/desci-models";

const CERAMIC_URL = process.env.CERAMIC_URL;
const MODULE_PATH = "/api/v2/resolvers/codex" as const;

const logger = parentLogger.child({
    module: MODULE_PATH,
    ceramicApi: CERAMIC_URL,
});

export type ResolveCodexParams = {
    streamOrCommitId: string;
    versionIx?: number;
};

export type ResolveCodexQueryParams = {
    /** @deprecated use format instead */
    raw?: "";
    /** @deprecated use format instead */
    jsonld?: "";
    format?: "jsonld" | "json" | "raw" | "myst";
};

export type ResolveCodexResponse =
    | HistoryQueryResult
    | string // RO-Crate if ?jsonLd query param is present
    | {
          error: string;
          details: unknown;
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
    req: Request<ResolveCodexParams, unknown, undefined, ResolveCodexQueryParams>,
    res: Response<ResolveCodexResponse>,
): Promise<typeof res | void> => {
    logger.info({ ...req.params }, `resolving codex entity with ${CERAMIC_URL}`);

    const { streamOrCommitId, versionIx } = req.params;
    const wantRaw = req.query.raw !== undefined || req.query.format === "raw";
    const wantJsonLd = req.query.jsonld !== undefined || req.query.format === "jsonld";
    const wantMyst = req.query.format === "myst";

    let codexPid: PID;
    try {
        codexPid = pidFromStringID(streamOrCommitId);
    } catch (e) {
        const errPayload = {
            error: "Invalid stream or commit ID",
            details: serializeError(e as Error),
            params: req.params,
            path: MODULE_PATH,
        };
        logger.error(errPayload, "Codex handler got invalid id");
        return res.status(400).send(errPayload);
    }
    const versionByCommit = codexPid.tag === "versioned";

    // If request contained a commitID, we can derive the stream ID from that
    const streamId = versionByCommit ? codexPid.id.baseID.toString() : codexPid.id.toString();

    let result: HistoryQueryResult;
    try {
        result = await resolveCodex(streamId, versionIx);
    } catch (e) {
        const err = e as Error;
        // TODO filter error for stream not found from technical issues
        logger.error({ streamId, versionIx, err }, "failed to resolve stream");
        return res.status(404).send({
            error: "Could not resolve; does stream/version exist?",
            details: serializeError(err),
            params: req.params,
            path: MODULE_PATH,
        });
    }

    // Result contains full history, but the top level manifest is the latest
    // entry if a versionIx wasn't passed. If a CommitID was included, set
    // top-level manifest to the CID from the corresponding version.
    if (versionByCommit) {
        const commitVersion = result.versions.find(({ version }) => version === codexPid.id.toString());
        if (!commitVersion) {
            // This is unlikely but very weird if it occurs, since we found the
            // stream from this commit ID
            logger.error({ streamOrCommitId, versions: result.versions }, "CommitID not found in stream versions");
            return res.status(404).send({
                error: "Could not resolve, does stream/version exist?",
                details: "CommitID not found in stream versions",
                params: req.params,
                path: MODULE_PATH,
            });
        }
        result.manifest = commitVersion.manifest;
    }

    const manifestUrl = `${IPFS_GATEWAY}/${result.manifest}`;
    if (wantRaw) {
        return res.redirect(manifestUrl);
    } else if (wantJsonLd) {
        const transformer = new RoCrateTransformer();
        const response = await fetch(manifestUrl);
        if (!response.ok) {
            return res.status(500).send({
                error: "Could not resolve manifest",
                details: `Couldn't find manifest ${result.manifest} for RO-Crate transform`,
                params: req.params,
                path: MODULE_PATH,
            });
        }
        const roCrate = transformer.exportObject(await response.json());
        return res.setHeader("Content-Type", "application/ld+json").send(JSON.stringify(roCrate));
    } else if (wantMyst) {
        const transformer = new MystTransformer();
        const response = await fetch(manifestUrl);
        const mystOutput = transformer.exportObject(await response.json());
        return res.setHeader("Content-Type", "text/myst").send(mystOutput);
    } else {
        return res.status(200).send(result);
    }
};

/** Resolve full stream history */
export const resolveCodex = async (streamId: string, versionIx?: number): Promise<HistoryQueryResult> => {
    const history = await getCodexHistory(streamId);

    if (versionIx !== undefined && versionIx > history.versions.length) {
        throw new Error("versionIx out of bounds");
    }

    if (versionIx !== undefined) {
        // overwrite the top-level manifest with the specified version
        history.manifest = history.versions[versionIx].manifest;
    }

    return history;
};
