import type { Request, Response } from "express";
import parentLogger from "../../../logger.js";
import { getDpidAliasRegistry } from "../../../util/config.js";
import { resolveCodex } from "./codex.js";
import { ResolverError } from "../../../errors.js";

const MODULE_PATH = "/api/v2/resolvers/codex" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

export type ResolveDpidRequest = {
    dpid: number;
    /** Zero-indexed version */
    versionIx?: number;
};

export type ResolveDpidResponse = ResolveDpidResult | ResolveDpidError;

export type ResolveDpidResult = {
    /** The resolved stream, undefined if legacy entry without mapped stream */
    streamId?: string;
    /** manifest CID */
    manifest: string;
};

export type ResolveDpidError = {
    error: string;
    details: any;
    params: ResolveDpidRequest;
    path: typeof MODULE_PATH;
};

/**
 * Find the manifest CID of a dPID
 */
export const resolveDpidHandler = async (
    req: Request<ResolveDpidRequest>,
    res: Response<ResolveDpidResponse>,
): Promise<any> => {
    logger.info(
        {
            params: req.params,
            query: req.query,
            path: req.path,
        },
        "Entered handler",
    );

    const { dpid, versionIx } = req.params;

    let result: ResolveDpidResult;
    try {
        result = await resolveDpid(dpid, versionIx);
    } catch (e) {
        if (e instanceof DpidResolverError) {
            const errPayload = {
                error: e.message,
                details: e.cause,
                params: req.params,
                path: MODULE_PATH,
            };
            logger.error(errPayload);
            return res.status(500).send(errPayload);
        } else {
            const err = e as Error;
            const errPayload = {
                error: err.message,
                details: err,
                params: req.params,
                path: MODULE_PATH,
            };
            logger.error(errPayload, "Unexpected error occurred");
            return res.status(501).send(errPayload);
        }
    }

    return res.status(200).send(result);
};

/**
 * Lookup the manifest of an optionally versioned dPID
 * @returns stream ID and manifest CID
 * @throws (@link DpidResolverError) on failure
 */
export const resolveDpid = async (dpid: number, versionIx?: number): Promise<ResolveDpidResult> => {
    const registry = getDpidAliasRegistry();
    let streamId;
    try {
        streamId = await registry.resolve(dpid);
    } catch (e) {
        throw new DpidResolverError({
            name: "RegistryContactFailed",
            message: "Failed to lookup dpid in alias registry",
            cause: e,
        });
    }

    let manifestCid: string | undefined;

    // Contract lookup returns zero value if key is not mapped
    if (streamId !== "") {
        try {
            manifestCid = (await resolveCodex(streamId, versionIx)).manifest;
        } catch (e) {
            throw new DpidResolverError({
                name: "CeramicContactFailed",
                message: "Failed to resolve stream",
                cause: e,
            });
        }
        logger.info({ dpid, manifestCid }, "successfully resolved dpid via stream");
        return { streamId, manifest: manifestCid };
    } else {
        // dPID alias was unmapped, try resolve as legacy entry
        logger.info({ dpid }, "alias not mapped, falling back to legacy lookup");
        try {
            const [owner, versions] = await registry.legacyLookup(dpid);
            const lastVersion = versions[versionIx ?? versions.length - 1];

            // Index 0 of the legacyEntry is the manifest CID
            manifestCid = lastVersion[0];
            logger.info(
                { dpid, owner, versions: versions.map(([cid]) => cid) },
                "manifest resolved via fallback to legacy entry",
            );
        } catch (e) {
            throw new DpidResolverError({
                name: "LegacyLookupError",
                message: "failed to lookup legacy dpid",
                cause: e,
            });
        }

        if (!manifestCid) {
            throw new DpidResolverError({
                name: "DpidNotFound",
                message: "dPID doesn't exist in registry",
                cause: "fallback to legacy lookup failed",
            });
        }
    }
    return { manifest: manifestCid };
};

type DpidErrorName = "RegistryContactFailed" | "CeramicContactFailed" | "LegacyLookupError" | "DpidNotFound";

export class DpidResolverError extends ResolverError<DpidErrorName> {}
