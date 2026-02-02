import type { ResearchObjectV1 } from "@desci-labs/desci-models";
import parentLogger from "../logger.js";
import { DPID_ENV, IPFS_GATEWAY } from "./config.js";
import { redisService } from "../redis.js";
import { errWithCause } from "pino-std-serializers";

const MODULE_PATH = "/util/manifests" as const;
const logger = parentLogger.child({
    module: MODULE_PATH,
});

const manifestCacheKey = (cid: string) => `resolver-${DPID_ENV}-manifest-${cid}`;
/* Cache manifests for a month as they are content addressed */
const MANIFEST_CACHE_TTL = 60 * 60 * 24 * 30;

export const getManifest = async (cid: string): Promise<ResearchObjectV1 | undefined> => {
    if (!cid) {
        logger.warn("getManifest got undefined CID");
        return undefined;
    }

    const startTime = Date.now();

    // Try cache
    const cachedManifest = await redisService?.getFromCache(manifestCacheKey(cid));
    if (cachedManifest) {
        logger.info({ cid, fetchTime: Date.now() - startTime }, "Fetched manifest from cache");
        // bump cache TTL as the manifest is actively resolved
        void redisService?.keyBump(manifestCacheKey(cid), MANIFEST_CACHE_TTL);
        return cachedManifest as ResearchObjectV1;
    }

    let response: Response;
    let timeoutId: NodeJS.Timeout | undefined;
    try {
        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 5000);
        response = await fetch(`${IPFS_GATEWAY}/${cid}`, {
            signal: controller.signal,
        });
    } catch (error) {
        if ((error as Error).name === "AbortError") {
            logger.warn({ cid, fetchTime: Date.now() - startTime }, "Manifest fetch timed out");
        } else {
            logger.error({ cid, error }, "Error fetching manifest from IPFS gateway");
        }
        return undefined;
    } finally {
        clearTimeout(timeoutId);
    }

    const fetchTime = Date.now() - startTime;

    if (!response.ok) {
        logger.error({ cid, fetchTime }, "Failed to fetch manifest from IPFS gateway");
        return undefined;
    }

    let parsedManifest: ResearchObjectV1;
    try {
        parsedManifest = (await response.json()) as ResearchObjectV1;
        void redisService?.setToCache(manifestCacheKey(cid), parsedManifest, MANIFEST_CACHE_TTL);
    } catch (e) {
        logger.error({ cid, error: errWithCause(e as Error), fetchTime }, "Failed to parse manifest");
        return undefined;
    }
    return parsedManifest;
};

// TypeScript type definitions - defined before usage
export type ManifestMetadata = {
    title?: string;
    description?: string;
    authors?: Array<{
        name?: string;
        orcid?: string;
    }>;
    keywords?: string[];
    license?: string;
    [key: string]: unknown; // Allow additional metadata fields
};

/**
 * Fetch and parse manifest metadata from IPFS
 */
export const getManifestMetadata = async (
    cid: string,
    fields: string[] = ["title", "authors", "description", "keywords", "license"],
): Promise<ManifestMetadata | null> => {
    if (!cid || cid === "") return null;

    try {
        const manifest = await getManifest(cid);
        if (!manifest) {
            logger.warn({ cid }, "No manifest found, returning null metadata");
            return null;
        }

        // Extract only the requested metadata fields
        const metadata: ManifestMetadata = {};

        if (fields.includes("title") && manifest.title) {
            metadata.title = manifest.title;
        }
        if (fields.includes("description") && manifest.description) {
            metadata.description = manifest.description;
        }
        if (fields.includes("license") && manifest.defaultLicense) {
            metadata.license = manifest.defaultLicense;
        }
        if (fields.includes("keywords") && manifest.keywords && Array.isArray(manifest.keywords)) {
            metadata.keywords = manifest.keywords;
        }

        // Extract authors from various possible formats
        if (fields.includes("authors") && manifest.authors && Array.isArray(manifest.authors)) {
            metadata.authors = manifest.authors
                .map((author) => {
                    const authorData: { name?: string; orcid?: string } = {};
                    if (author.name) authorData.name = author.name;
                    if (author.orcid) authorData.orcid = author.orcid;
                    return authorData;
                })
                .filter((author: { name?: string; orcid?: string }) => author.name || author.orcid);
        }

        logger.info({ cid, fieldsRequested: fields, fieldsFound: Object.keys(metadata) }, "Fetched manifest metadata");
        return metadata;
    } catch (e) {
        logger.warn({ cid, error: errWithCause(e as Error) }, "Failed to extract metadata from manifest");
        return null;
    }
};
