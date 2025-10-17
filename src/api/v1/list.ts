/**
NOTE: this module depends on the semi-defunct subgraph index, meaning it only covers
dPIDs up to 261 in prod and fails in dev.

Kept around on life support as a couple of migration/dpid repair scripts in desci-server uses it.
*/

import { type Request, type Response } from "express";
import { safeHexToCid } from "../../util/conversions.js";
import { getAllDpidRegisrations, getAllResearchObjectsForDpidRegistrations } from "../../theGraph.js";
import parentLogger from "../../logger.js";
import analytics, { LogEventType } from "../../analytics.js";
const logger = parentLogger.child({ module: "api/v1/list" });

export interface DpidRequest {
    dpid: string;
    version?: string;
    suffix?: string;
    prefix: string;
    /** @deprecated use format instead */
    raw?: boolean;
    /** @deprecated use format instead */
    jsonld?: boolean;
    domain?: string;
    format?: "jsonld" | "json" | "raw" | "myst";
}

// the value of string "beta" in bytes32 encoded as hex
export const PREFIX_HARDCODE_BETA = "0x6265746100000000000000000000000000000000000000000000000000000000";

export const THE_GRAPH_RESOLVER_URL: { [key: string]: string } =
    process.env.DPID_ENV === "dev"
        ? {
              beta: "https://graph-sepolia-dev.desci.com/subgraphs/name/nodes",
              __registry: "https://graph-sepolia-dev.desci.com/subgraphs/name/dpid-registry",
          }
        : process.env.DPID_ENV === "staging"
          ? {
                beta: "https://graph-sepolia-prod.desci.com/subgraphs/name/nodes",
                __registry: "https://graph-sepolia-prod.desci.com/subgraphs/name/dpid-registry",
            }
          : {
                beta: "https://graph-sepolia-prod.desci.com/subgraphs/name/nodes",
                __registry: "https://graph-sepolia-prod.desci.com/subgraphs/name/dpid-registry",
            };

interface GraphResultVersion {
    id: string;
    cid: string;
    time: string;
}

export interface GraphResult {
    id: string;
    id10: string;
    recentCid: string;
    owner: string;
    versions: GraphResultVersion[];
}

const transformGraphResult =
    (transactionHashToDpid: { [hash: string]: string }) => (r: ResearchObjectVersionResult) => {
        return {
            dpid: transactionHashToDpid[r.id],
            id: r.id,
            recentCid: safeHexToCid(r.researchObject.versions[r.researchObject.versions.length - 1].cid),
            researchObject: {
                owner: r.researchObject.owner,
                id: r.researchObject.id,
                versions: r.researchObject.versions.map((v, index) => ({
                    ...v,
                    index,
                    time: parseInt(v.time),
                    cid: safeHexToCid(v.cid),
                })),
            },
        };
    };

interface DpidRegistryResult {
    transactionHash: string;
    entryId: string;
}

interface ResearchObjectVersionResult {
    id: string;
    cid: string;
    researchObject: GraphResult;
}

export type SortDirection = "asc" | "desc";

export const list = async (req: Request, res: Response) => {
    logger.info("GET /api/v1/dpid");
    const page = parseInt(req.query.page as string) || 1;
    const size = parseInt(req.query.size as string) || 100;
    const sort: SortDirection = (req.query.sort as SortDirection) || "desc";
    analytics.log({ dpid: 0, version: 1, eventType: LogEventType.DPID_LIST, extra: { page, size } });

    try {
        const graphUrlRo = THE_GRAPH_RESOLVER_URL["beta"];
        const graphUrlDpid = THE_GRAPH_RESOLVER_URL["__registry"];
        // TODO: add pagination
        // TODO: add support for multiple prefixes
        const dpidToTransactionHash: { [dpid: string]: string } = {};
        const transactionHashToDpid: { [hash: string]: string } = {};
        const dpidResult: DpidRegistryResult[] = (
            await getAllDpidRegisrations(graphUrlDpid, PREFIX_HARDCODE_BETA, page, size, sort)
        ).registers;
        dpidResult.forEach((r) => {
            dpidToTransactionHash[r.entryId] = r.transactionHash;
            transactionHashToDpid[r.transactionHash] = r.entryId;
        });
        const graphResult: ResearchObjectVersionResult[] = (
            await getAllResearchObjectsForDpidRegistrations(graphUrlRo, Object.keys(transactionHashToDpid))
        ).researchObjectVersions;

        res.json(graphResult.map(transformGraphResult(transactionHashToDpid)));
    } catch (err) {
        const error = err as Error;
        res.json({ ok: false, error: error.message, path: "/api/v1/dpid" }).status(500);
        logger.error("ERROR", error.message);
    }
};
