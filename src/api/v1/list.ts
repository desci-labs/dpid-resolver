import { type Request, type Response } from "express";
import {
    type GraphResult,
    PREFIX_HARDCODE_BETA,
    THE_GRAPH_RESOLVER_URL,
    hexToCid,
} from "../../dpid-reader/DpidReader.js";
import {
    getAllDpidRegisrations,
    getAllResearchObjectsForDpidRegistrations,
} from "../../dpid-reader/TheGraphResolver.js";
import parentLogger from "../../logger.js";
import analytics, { LogEventType } from "../../analytics.js";
const logger = parentLogger.child({ module: "api/v1/list" });

const safeHexToCid = (hex: string) => {
    return hex.length > 2 ? hexToCid(hex) : "";
};

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
