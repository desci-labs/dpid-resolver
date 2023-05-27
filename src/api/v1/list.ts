import { Request, Response } from "express";
import { GraphResult, PREFIX_HARDCODE_BETA, THE_GRAPH_RESOLVER_URL, hexToCid } from "../../dpid-reader/DpidReader";
import { getAllDpidRegisrations, getAllResearchObjectsForDpidRegistrations } from "../../dpid-reader/TheGraphResolver";

const safeHexToCid = (hex: string) => {
    return hex.length > 2 ? hexToCid(hex) : "";
};

const transformGraphResult = (transactionHashToDpid: {[hash:string]: string}) => (r: ResearchObjectVersionResult) => {
    return {
        dpid: transactionHashToDpid[r.id],
        id: r.id,
        recentCid: safeHexToCid(r.researchObject.versions[r.researchObject.versions.length -1].cid),
        researchObject: {
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

export const list = async (req: Request, res: Response) => {
    console.log("GET /api/v1/dpid")
    try {
        const graphUrlRo = THE_GRAPH_RESOLVER_URL["beta"];
        const graphUrlDpid = THE_GRAPH_RESOLVER_URL["__registry"];
        // TODO: add pagination
        // TODO: add support for multiple prefixes
        const dpidToTransactionHash: { [dpid: string]: string } = {};
        const transactionHashToDpid: { [hash: string]: string } = {};
        const dpidResult: DpidRegistryResult[] = (await getAllDpidRegisrations(graphUrlDpid, PREFIX_HARDCODE_BETA))
            .registers;
        dpidResult.forEach((r) => {
            dpidToTransactionHash[r.entryId] = r.transactionHash;
            transactionHashToDpid[r.transactionHash] = r.entryId;
        });
        const graphResult: ResearchObjectVersionResult[] = (
            await getAllResearchObjectsForDpidRegistrations(graphUrlRo, Object.keys(transactionHashToDpid))
        ).researchObjectVersions;

        res.json(graphResult.map(transformGraphResult(transactionHashToDpid)));
    } catch (err: any) {
        res.json({ ok: false, error: err.message }).status(500);
        console.log("ERROR", err.message)
    }
};
