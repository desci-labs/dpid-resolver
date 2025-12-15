import type { ResearchObjectV1 } from "@desci-labs/desci-models";
import parentLogger from "../logger.js";
import { IPFS_GATEWAY } from "./config.js";

const MODULE_PATH = "/util/manifests" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

export const getManifest = async (cid: string): Promise<ResearchObjectV1 | undefined> => {
    let response;
    try {
        response = await fetch(`${IPFS_GATEWAY}/${cid}`);
    } catch (error) {
        logger.error({ cid, error }, "Network error fetching manifest from IPFS gateway");
        return undefined;
    }
    if (!response.ok) {
        logger.error({ cid }, "Failed to fetch manifest from IPFS gateway");
        return undefined;
    }

    let parsedManifest: ResearchObjectV1;
    try {
        parsedManifest = (await response.json()) as ResearchObjectV1;
    } catch (_) {
        logger.error({ cid }, "Failed to parse manifest");
        return undefined;
    }
    return parsedManifest;
};
