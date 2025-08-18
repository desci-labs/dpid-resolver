import type { Request, Response } from "express";
import axios from "axios";
import { RoCrateTransformer, type ResearchObjectV1 } from "@desci-labs/desci-models";

import parentLogger, { serializeError } from "../../../logger.js";
import analytics, { LogEventType } from "../../../analytics.js";
import { IPFS_GATEWAY, getNodesUrl } from "../../../util/config.js";
import { buildMystPageFromManifest } from "../../../util/myst.js";
import { DpidResolverError, resolveDpid } from "./dpid.js";
import type { HistoryQueryResult } from "../queries/history.js";
import { isDpid, isVersionString } from "../../../util/validation.js";

const MODULE_PATH = "/api/v2/resolvers/generic" as const;

const logger = parentLogger.child({
    module: MODULE_PATH,
});

const IPFS_API_URL = IPFS_GATEWAY.replace(/\/ipfs\/?$/, "/api/v0");
const NODES_URL = getNodesUrl();

export type ResolveGenericParams = {
    // This is how express maps a wildcard :shrug:
    0: string;
};

export type ResolveGenericQueryParams = {
    /** @deprecated use format instead */
    raw?: "";
    /** @deprecated use format instead */
    jsonld?: "";
    format?: "jsonld" | "json" | "raw" | "myst";
};

export type ErrorResponse = {
    error: string;
    details: unknown;
    params: Record<string, string>;
    query: Record<string, string>;
    path: typeof MODULE_PATH;
};

export type SuccessResponse =
    | ResearchObjectV1 // raw request on plain dPID, i.e. no DAG path
    | unknown; // in case of directly returning an UnixFS data node

export type ResolveGenericResponse = SuccessResponse | ErrorResponse;

/**
 * Resolve a dPID path. Will redirect to Nodes as viewer,
 * unless the `&raw` query parameter is set in the URL.
 *
 * @returns response with the target data, void in the case of a redirect
 */
export const resolveGenericHandler = async (
    req: Request<ResolveGenericParams, unknown, undefined, ResolveGenericQueryParams>,
    res: Response<ResolveGenericResponse>,
): Promise<typeof res | void> => {
    const path = req.params[0];
    const query = req.query;

    if (path.includes("favicon.ico")) {
        return res.status(404).send();
    }

    const baseError = {
        params: req.params,
        query: req.query,
        path: MODULE_PATH,
    };

    logger.info({ path, query }, `Resolving path: ${path}`);

    const [dpid, ...rest] = path.split("/");
    if (!isDpid(dpid)) {
        logger.error({ path }, "invalid dpid");
        return res.status(400).send({
            error: "invalid dpid",
            details: `expected valid dpid in path, got '${dpid}'`,
            ...baseError,
        });
    }

    // Smart format detection to avoid CORS issues while preserving human-readable redirects
    // Default to raw for API requests (to prevent CORS), but redirect browsers to Nodes
    const acceptHeader = req.headers.accept || "";
    const isApiRequest = acceptHeader.includes("application/json") && !acceptHeader.includes("text/html");

    const isRaw =
        query.raw !== undefined ||
        query.format === "raw" ||
        (query.format === undefined && isApiRequest) ||
        query.format === "json";
    const isJsonld = query.jsonld !== undefined || query.format === "jsonld";
    const isMyst = query.format === "myst";

    /** dPID version identifier, possibly adjusted to 0-based indexing */
    let versionIx: number | undefined;
    /** dPID path suffix, possibly empty */
    let suffix = "";
    if (rest.length > 0) {
        const maybeVersionString = rest[0];
        if (isVersionString(maybeVersionString)) {
            versionIx = getVersionIndex(maybeVersionString);
            suffix = rest.slice(1).join("/");
            logger.info({ dpid, path, versionIx, suffix }, "extracted version from path");
        } else {
            versionIx = undefined;
            suffix = rest.join("/");
            logger.info(
                { dpid, path, versionIx, suffix },
                "couldn't extract version, considering first segment part of path suffix",
            );
        }
    }

    if (isJsonld) {
        logger.warn({ path, query }, "got request for jsonld");
        const resolveResult = await resolveDpid(parseInt(dpid), versionIx);

        // console.log({ resolveResult });

        const manifestUrl = `${IPFS_GATEWAY}/${resolveResult.manifest}`;

        const transformer = new RoCrateTransformer();

        const response = await fetch(manifestUrl);

        // console.log({ manifestUrl });

        const roCrate = transformer.exportObject(await response.json());

        return res.setHeader("Content-Type", "application/ld+json").send(JSON.stringify(roCrate));
    }

    if (isMyst) {
        logger.warn({ path, query }, "got request for myst");
        const resolveResult = await resolveDpid(parseInt(dpid), versionIx);

        const manifestUrl = `${IPFS_GATEWAY}/${resolveResult.manifest}`;
        const response = await fetch(manifestUrl);
        if (!response.ok) {
            return res.status(500).send({ error: "Could not fetch manifest", manifest: resolveResult.manifest });
        }

        const manifest = (await response.json()) as ResearchObjectV1;

        const page = await buildMystPageFromManifest({
            manifest,
            dpid: parseInt(dpid),
            history: resolveResult,
        });

        return res.setHeader("Content-Type", "application/json").send(JSON.stringify(page));
    }

    analytics.log({
        dpid: parseInt(dpid),
        version: versionIx || -1,
        eventType: LogEventType.DPID_GET,
        extra: {
            dpid,
            version: versionIx,
            raw: isRaw,
            jsonld: isJsonld,
            myst: isMyst,
            domain: req.hostname,
            params: req.params,
            query: req.query,
            suffix,
        },
    });

    // Redirect non-raw resolution requests to the Nodes gateway
    if (!isRaw) {
        let target = `${NODES_URL}/dpid/${dpid}`;

        if (versionIx !== undefined) {
            // Nodes always wants v-prefixed one-based indexing
            target += `/v${versionIx + 1}`;
        }

        if (suffix) {
            // Let Nodes figure out what to do if path doesn't make sense
            target += `/${suffix}`;
        }

        logger.info({ dpid, target, path, query }, "redirecting root dPID reference to Nodes");
        return res.redirect(target);
    }

    // If we didn't redirect to the Nodes app, we're either dealing with a raw
    // request or a file path, in either case we need to fetch the manifest
    let resolveResult: HistoryQueryResult;
    try {
        resolveResult = await resolveDpid(parseInt(dpid), versionIx);
        logger.info({ dpid, path, query }, "resolved dpid manifest");
    } catch (e) {
        if (e instanceof DpidResolverError) {
            const errPayload = {
                error: e.message,
                details: serializeError(e.cause),
                ...baseError,
            };
            logger.error(errPayload, "failed to resolve dpid");
            return res.status(500).send(errPayload);
        } else {
            const err = e as Error;
            const errPayload = {
                error: err.message,
                details: serializeError(err),
                ...baseError,
            };
            logger.error(errPayload, "unexpected error occurred");
            return res.status(503).send(errPayload);
        }
    }

    /** dPID path doesn't refer to a file in the data tree */
    const noDagPath = suffix.length === 0;
    const manifestUrl = `${IPFS_GATEWAY}/${resolveResult.manifest}`;

    if (noDagPath) {
        // Return manifest url as is
        logger.info({ dpid, manifestUrl, path, query, suffix }, "redirecting raw request to IPFS resolver");
        return res.redirect(manifestUrl);
    } else if (suffix.startsWith("root") || suffix.startsWith("data")) {
        logger.info({ dpid, path, query, suffix }, "assuming suffix is a drive path");
        // The suffix is pointing to a target in drive, let's find the UnixFS root
        const manifest = (await fetch(manifestUrl).then(async (r) => await r.json())) as ResearchObjectV1;
        const maybeDataBucket = manifest.components.find((c) => c.name === "root");
        // || manifest.components[0] shouldn't be necessary?

        if (!maybeDataBucket) {
            const errPayload = {
                error: "Invalid dPID path",
                details: "Manifest doesn't have a data bucket, this is unexpected",
                ...baseError,
            };
            logger.error(errPayload, "missing data bucket");
            return res.status(410).send(errPayload);
        }

        const dagPath = `${maybeDataBucket.payload.cid}/${suffixToDagPath(suffix)}`;
        // Convert gateway to API URl
        const maybeValidDagUrl = `${IPFS_API_URL}/dag/get?arg=${dagPath}`;

        try {
            // Let's be optimistic
            const { data } = await axios({ method: "POST", url: maybeValidDagUrl });
            logger.info({ ipfsData: data }, "IPFS DATA");

            // Check for magical UnixFS clues
            if (magicIsUnixDir(data)) {
                // It's a dir, respond with the raw IPLD node as JSON
                return res.status(200).send(data);
            } else {
                // It's a file or some random shit, redirect to resolver to
                // dodge relaying a large transfer
                return res.redirect(`${IPFS_GATEWAY}/${dagPath}`);
            }
        } catch (e) {
            // Doesn't seem it was a validDagUrl
            const errPayload = {
                error: "Failed to resolve DAG URL; check path and versioning",
                details: serializeError(e as Error),
                ...baseError,
            };
            logger.error(errPayload, "got invalid DAG URL");
            return res.status(404).send(errPayload);
        }
    } else {
        // Other cases are illegal, unclear what's going on
        const errPayload = {
            error: "Invalid dPID path",
            details: "Path suffix must reference to address drive content /root",
            suffix,
            ...baseError,
        };
        logger.error(errPayload, "invalid path suffix");
        return res.status(400).send(errPayload);
    }
};

const getVersionIndex = (versionString: string): number => {
    let index;
    if (versionString.startsWith("v")) {
        // Compensate for one-based indexing
        index = parseInt(versionString.slice(1)) - 1;
    } else {
        index = parseInt(versionString);
    }

    logger.info({ versionString, index }, "parsed version string");
    return index;
};

/**
 * Fun with IPLD/UnixFS part 4512:
 * - UnixFS data follows this protobuf schema: https://github.com/ipfs/specs/blob/main/UNIXFS.md#data-format
 * - Length-delimited protobuf encoding writes each fields as [size,data]
 * - The `Type` field is an enum, which is 8 bits long by default
 * - `Directory` has the enum value `1`
 * - [0x8,0x1] in base64 => CAE
 *
 * Hence, "CAE" obviously says "I'm a directory!"
 */
const MAGIC_UNIXFS_DIR_FLAG = "CAE";

/* eslint-disable @typescript-eslint/no-explicit-any */
const magicIsUnixDir = (mysteriousData: any) => mysteriousData.Data?.["/"]?.bytes === MAGIC_UNIXFS_DIR_FLAG;

const rBucketRefHead = /^(root|data)\/?/;

/**
 * Cleanup leading data bucket references, and remove any trailing query params
 */
const suffixToDagPath = (suffix: string) => suffix.replace(rBucketRefHead, "");
