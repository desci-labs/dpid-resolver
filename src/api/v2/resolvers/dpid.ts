import type { Request, Response } from "express";
import parentLogger from "../../../logger.js";
import { getDpidAliasRegistry } from "../../../util/config.js";
import { resolveCodex } from "./codex.js";
import { ResolverError } from "../../../errors.js";
import type { HistoryQueryResult, HistoryVersion } from "../queries/history.js";
import { BigNumber } from "ethers";

const MODULE_PATH = "/api/v2/resolvers/codex" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

export type ResolveDpidRequest = {
    dpid: number;
    /** Zero-indexed version */
    versionIx?: number;
};

export type ResolveDpidResponse = HistoryQueryResult | ResolveDpidError;

export type ResolveDpidError = {
    error: string;
    details: unknown;
    params: ResolveDpidRequest;
    path: typeof MODULE_PATH;
};

/**
 * Find the history of a dPID. Note that streamID and version ID will be empty
 * strings in case a dPID is resolved through the legacy mapping.
 */
export const resolveDpidHandler = async (
    req: Request<ResolveDpidRequest>,
    res: Response<ResolveDpidResponse>,
): Promise<typeof res> => {
    logger.info(
        {
            params: req.params,
            query: req.query,
            path: req.path,
        },
        "Entered handler",
    );

    const { dpid, versionIx } = req.params;

    let result: HistoryQueryResult;
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

/** HistoryQueryResult possibly without stream ID and commit IDs, in case
 * resolution was made though the legacy mapping
 */
export type DpidHistoryQueryResult = Omit<HistoryQueryResult, "id" | "versions"> & {
    id?: string;
    versions: (Omit<HistoryVersion, "version"> & { version?: string })[];
};

/**
 * Lookup the history of a dPID
 * @returns dPID history
 * @throws (@link DpidResolverError) on failure
 */
export const resolveDpid = async (dpid: number, versionIx?: number): Promise<HistoryQueryResult> => {
    const registry = getDpidAliasRegistry();

    /** Empty string if dpid unmapped in registry */
    let streamId: string;
    try {
        streamId = await registry.resolve(dpid);
    } catch (e) {
        throw new DpidResolverError({
            name: "RegistryContactFailed",
            message: "Failed to lookup dpid in alias registry",
            cause: e,
        });
    }

    let result: HistoryQueryResult;
    if (streamId !== "") {
        try {
            result = await resolveCodex(streamId, versionIx);
        } catch (e) {
            throw new DpidResolverError({
                name: "CeramicContactFailed",
                message: "Failed to resolve; does the dpid (or version) exist?",
                cause: e,
            });
        }
        logger.info(result, "manifest resolved via stream");
        return result;
    }

    logger.info({ dpid }, "alias not mapped, falling back to legacy lookup");
    try {
        const [owner, versions] = await registry.legacyLookup(dpid);
        const requestedVersion = versions[versionIx ?? versions.length - 1];

        result = {
            // No StreamID available
            id: "",
            owner,
            manifest: requestedVersion[0],
            versions: versions.map(([manifest, time]) => ({
                // No CommitID available
                version: "",
                time: BigNumber.from(time).toNumber(),
                manifest,
            })),
        };
        logger.info(result, "manifest resolved via fallback to legacy entry");
        return result;
    } catch (e) {
        throw new DpidResolverError({
            name: "LegacyLookupError",
            message: "failed to lookup legacy dpid",
            cause: e,
        });
    }
};

type DpidErrorName = "RegistryContactFailed" | "CeramicContactFailed" | "LegacyLookupError" | "DpidNotFound";

export class DpidResolverError extends ResolverError<DpidErrorName> {}
