import type { Request, Response } from "express";
import parentLogger, { serializeError } from "../../../logger.js";
import { pidFromStringID, type PID } from "@desci-labs/desci-codex-lib";
import { getCodexHistory, type HistoryQueryResult } from "../queries/history.js";
import { IPFS_GATEWAY } from "../../../util/config.js";
import { RoCrateTransformer } from "@desci-labs/desci-models";
import { getStreamHistory } from "@desci-labs/desci-codex-lib/c1/resolve";
import { cleanupEip155Address } from "../../../util/conversions.js";
import { flightClient } from "../../../flight.js";
import { getManifest } from "../../../util/manifests.js";

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

    const { streamOrCommitId } = req.params;
    const versionIx = req.params.versionIx !== undefined ? Number(req.params.versionIx) : undefined;
    if (Number.isNaN(versionIx)) {
        return res.status(400).send({
            error: "versionIx must be a number",
            details: `versionIx is ${req.params.versionIx} of type ${typeof req.params.versionIx}`,
            params: req.params,
            path: MODULE_PATH,
        });
    }
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

    let historyResult: HistoryQueryResult;
    try {
        historyResult = await resolveCodex(streamId, versionIx);
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
        const commitVersion = historyResult.versions.find(({ version }) => version === codexPid.id.toString());
        if (!commitVersion) {
            // This is unlikely but very weird if it occurs, since we found the
            // stream from this commit ID
            logger.error(
                { streamOrCommitId, versions: historyResult.versions },
                "CommitID not found in stream versions",
            );
            return res.status(404).send({
                error: "Could not resolve, does stream/version exist?",
                details: "CommitID not found in stream versions",
                params: req.params,
                path: MODULE_PATH,
            });
        }
        historyResult.manifest = commitVersion.manifest;
    }

    /* Return early with a redirect if the raw manifest file was requested */
    const cid = historyResult.manifest;
    if (wantRaw) {
        return res.redirect(`${IPFS_GATEWAY}/${cid}`);
    }

    if (wantJsonLd) {
        const manifest = await getManifest(cid);
        if (!manifest) {
            return res.status(500).send({
                error: "Could not resolve manifest",
                details: `Couldn't find manifest ${cid} for RO-Crate transform`,
                params: req.params,
                path: MODULE_PATH,
            });
        }
        const transformer = new RoCrateTransformer();
        const roCrate = transformer.exportObject(manifest);
        return res.setHeader("Content-Type", "application/ld+json").send(JSON.stringify(roCrate));
    }

    if (wantMyst) {
        const manifest = await getManifest(cid);
        if (!manifest) {
            return res.status(500).send({
                error: "Could not resolve manifest",
                details: `Couldn't find manifest ${cid} for MyST transform`,
                params: req.params,
                path: MODULE_PATH,
            });
        }
        // We do not know IJ id here; just set slug to stream id string fallback
        const page: {
            version: number;
            kind: string;
            sha256: string;
            slug: string;
            location: string;
            dependencies: unknown[];
            frontmatter: {
                title?: string;
                abstract?: string;
                license?: string;
                keywords?: string[];
                tags?: string[];
                authors?: Array<{
                    name: string;
                    roles?: string[];
                    orcid?: string;
                    institutions?: string[];
                }>;
            };
            mdast: { type: string };
            references: Array<{ type?: string; id?: string; title?: string }>;
        } = {
            version: 2,
            kind: "Article",
            sha256: "",
            slug: streamOrCommitId,
            location: "",
            dependencies: [],
            frontmatter: {
                title: manifest.title,
                abstract: manifest.description,
                license: manifest.defaultLicense,
                keywords: manifest.keywords,
                tags: manifest.tags?.map((t) => t.name),
                authors: manifest.authors?.map((a) => ({
                    name: a.name,
                    roles: Array.isArray(a.role) ? (a.role as string[]) : [a.role as string],
                    orcid: a.orcid,
                    institutions: a.organizations?.map((o) => o.name),
                })),
            },
            mdast: { type: "root" },
            references: manifest.references?.map((r) => ({ type: r.type, id: r.id, title: r.title })) ?? [],
        };
        return res.setHeader("Content-Type", "application/json").send(JSON.stringify(page));
    }

    /* Default to the raw history response if no other format was requested */
    return res.status(200).send(historyResult);
};

/** Resolve full stream history */
export const resolveCodex = async (streamId: string, versionIx?: number): Promise<HistoryQueryResult> => {
    let history;
    if (flightClient) {
        history = await getStreamHistory(flightClient, streamId);
        history.owner = cleanupEip155Address(history.owner);
    } else {
        history = await getCodexHistory(streamId);
    }

    if (versionIx !== undefined && versionIx > history.versions.length - 1) {
        throw new Error("versionIx out of bounds");
    }

    if (versionIx !== undefined) {
        // overwrite the top-level manifest with the specified version
        history.manifest = history.versions[versionIx].manifest;
    }

    return history;
};
