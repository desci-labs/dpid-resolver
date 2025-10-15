import axios from "axios";
import type { ResearchObjectV1 } from "@desci-labs/desci-models";

import { CACHE_TTL_ANCHORED, DPID_ENV, IPFS_GATEWAY } from "../../../util/config.js";
import parentLogger from "../../../logger.js";
import { resolveDpid } from "../resolvers/dpid.js";
import { redisService } from "../../../redis.js";

const logger = parentLogger.child({ module: "/api/v2/data/getIpfsFolder" });

const IPFS_DAG_API_URL = process.env.IPFS_DAG_API_URL ?? "https://ipfs.desci.com/api/v0";
// Fallback IPFS gateways with DAG API support (if configured)
const IPFS_DAG_API_FALLBACK_URLS = process.env.IPFS_DAG_API_FALLBACK_URL ? [process.env.IPFS_DAG_API_FALLBACK_URL] : [];
// Public HTTP gateways for fetching raw content when DAG API is unavailable
const PUBLIC_IPFS_GATEWAYS = process.env.PUBLIC_IPFS_GATEWAYS
    ? process.env.PUBLIC_IPFS_GATEWAYS.split(",")
    : ["https://ipfs.io/ipfs", "https://dweb.link/ipfs", "https://cloudflare-ipfs.com/ipfs"];
const MAGIC_UNIXFS_DIR_FLAG = "CAE"; // length-delimited protobuf [0x08, 0x01] => Directory

const getKeyForIpfsTree = (cid: string, rootName: string, depthKey: string) =>
    `resolver-v2-${DPID_ENV}-ipfs-tree-${rootName}-${depthKey}-${cid}`;

export type IpfsEntry = {
    name: string;
    path: string;
    cid: string;
    size?: number;
    type: "file" | "directory";
    children?: IpfsEntry[];
};

/**
 * Fetch raw content from public HTTP gateway and create a minimal DAG structure.
 * This is a fallback when DAG API is unavailable.
 */
const fetchViaPublicHttpGateway = async (cid: string): Promise<unknown> => {
    for (const gateway of PUBLIC_IPFS_GATEWAYS) {
        try {
            const url = `${gateway}/${cid}`;
            const response = await axios({
                method: "GET",
                url,
                timeout: 30000,
                responseType: "arraybuffer",
                maxContentLength: 100 * 1024 * 1024, // 100MB max
                validateStatus: (status) => status === 200 || status === 404,
            });

            if (response.status === 200) {
                logger.info(
                    {
                        cid,
                        gateway,
                        size: response.data.byteLength,
                        contentType: response.headers["content-type"],
                    },
                    "Successfully fetched content from public HTTP gateway",
                );

                // Create a minimal DAG-like structure for file content
                // This mimics what the DAG API would return for a raw file
                return {
                    Data: {
                        "/": {
                            bytes: Buffer.from(response.data).toString("base64"),
                        },
                    },
                    Links: [], // Files have no links
                };
            }
        } catch (error) {
            const axiosError = error as { response?: { status?: number }; message?: string };
            if (axiosError.response?.status === 404) {
                logger.debug({ cid, gateway }, "CID not found on this public gateway");
                continue;
            }
            logger.debug({ cid, gateway, error: axiosError.message }, "Failed to fetch from public gateway");
        }
    }
    return null;
};

export const ipfsCat = async (arg: string): Promise<unknown> => {
    const url = `${IPFS_GATEWAY.replace(/\/ipfs$/, "")}/api/v0/cat?arg=${encodeURIComponent(arg)}`;
    logger.info({ url }, "Fetching IPFS content via public HTTP gateway");
    const { data } = await axios({
        method: "GET",
        url,
        headers: {
            "Content-Type": "application/json",
        },
    });
    return data;
};

export type EnhancedIpfsEntry = IpfsEntry & { gateway?: string; cid: string; name: string };

/** Fetch a DAG node via IPFS HTTP API with retry logic and fallback gateway support */
export const fetchDagNode = async (arg: string, retries = 2): Promise<EnhancedIpfsEntry> => {
    const gateways = [IPFS_DAG_API_URL, ...IPFS_DAG_API_FALLBACK_URLS];
    let lastError: unknown;

    for (const gatewayUrl of gateways) {
        const url = `${gatewayUrl}/dag/get?arg=${encodeURIComponent(arg)}`;

        for (let attempt = 0; attempt <= retries; attempt++) {
            const chosenGateway = gatewayUrl;
            try {
                const { data } = await axios({
                    method: "POST",
                    url,
                    timeout: 30000, // 30 second timeout
                });
                // Log if we had to use a fallback gateway
                if (gatewayUrl !== IPFS_DAG_API_URL) {
                    logger.info(
                        {
                            cid: arg,
                            gateway: gatewayUrl,
                        },
                        "Successfully fetched DAG node from fallback gateway",
                    );
                }
                return { ...data, gateway: chosenGateway } as EnhancedIpfsEntry;
            } catch (error) {
                const axiosError = error as {
                    response?: { status?: number; data?: { Message?: string } };
                    message?: string;
                };
                lastError = error;
                const isLastAttempt = attempt === retries;
                const status = axiosError?.response?.status;
                const errorMessage = axiosError?.response?.data?.Message;

                // If it's a 500 with "merkledag: not found", try next gateway immediately
                if (status === 500 && errorMessage?.includes("not found")) {
                    logger.debug(
                        {
                            cid: arg,
                            gateway: gatewayUrl,
                            message: errorMessage,
                        },
                        "CID not found on this gateway, trying next",
                    );
                    break; // Try next gateway
                }

                // Don't retry on 4xx errors (client errors) unless it's 429 (rate limit)
                if (status && status >= 400 && status < 500 && status !== 429) {
                    break; // Try next gateway
                }

                if (isLastAttempt) {
                    logger.debug(
                        {
                            error: axiosError.message,
                            cid: arg,
                            status,
                            gateway: gatewayUrl,
                            attempts: attempt + 1,
                        },
                        "Failed to fetch DAG node from gateway after retries",
                    );
                    break; // Try next gateway
                }

                // Exponential backoff: 500ms, 1s
                const delay = Math.pow(2, attempt) * 500;
                logger.debug(
                    {
                        cid: arg,
                        attempt: attempt + 1,
                        delay,
                        status,
                        gateway: gatewayUrl,
                    },
                    "Retrying DAG fetch",
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }

    // All DAG API gateways failed - try public HTTP gateway as last resort
    const lastErrorTyped = lastError as { response?: { data?: { Message?: string } }; message?: string } | undefined;
    const errorMsg = lastErrorTyped?.response?.data?.Message || lastErrorTyped?.message || "Unknown error";

    logger.debug({ cid: arg }, "All DAG API gateways failed, trying public HTTP gateways");
    const publicData = await fetchViaPublicHttpGateway(arg);

    if (publicData) {
        logger.info(
            {
                cid: arg,
                note: "Content fetched from public IPFS gateway - consider pinning to ipfs.desci.com",
            },
            "Using public gateway fallback for missing CID",
        );
        return { ...publicData, gateway: "public" } as EnhancedIpfsEntry;
    }

    // Content not found anywhere
    throw new Error(`Failed to fetch DAG node ${arg} from all available gateways: ${errorMsg}`);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const isUnixFsDirectory = (dagNode: any): boolean => dagNode?.Data?.["/"]?.bytes === MAGIC_UNIXFS_DIR_FLAG;

/**
 * Recursively build a folder tree starting from a UnixFS root CID.
 * Limits concurrent DAG fetches to avoid overloading the IPFS gateway.
 */
export const getIpfsFolderTreeByCid = async (
    rootCid: string,
    options?: { rootName?: string; concurrency?: number; depth?: number | "full" },
): Promise<IpfsEntry> => {
    const rootName = options?.rootName ?? "root";
    const maxConcurrency = Math.max(1, Math.min(options?.concurrency ?? 8, 16));
    const maxDepth: number | "full" = options?.depth ?? 1;

    const depthKey = maxDepth === "full" ? "full" : `d${maxDepth}`;
    const cacheKey = getKeyForIpfsTree(rootCid, rootName, depthKey);
    if (redisService) {
        try {
            const cached = await redisService.getFromCache<IpfsEntry>(cacheKey);
            if (cached !== null) {
                void redisService.keyBump(cacheKey, CACHE_TTL_ANCHORED).catch((error) => {
                    logger.warn({ error, key: cacheKey }, "Failed to bump Redis key TTL for ipfs tree");
                });
                return cached;
            }
        } catch (error) {
            logger.warn({ error, key: cacheKey }, "Failed to read from Redis cache for ipfs tree");
        }
    }

    const rootDag: any = await fetchDagNode(rootCid);
    const rootIsDir = isUnixFsDirectory(rootDag);
    if (!rootIsDir) {
        const fileEntry: EnhancedIpfsEntry = {
            name: rootName,
            path: rootName,
            cid: rootCid,
            type: "file",
            gateway: rootDag.gateway,
        };
        if (redisService) {
            void redisService.setToCache(cacheKey, fileEntry, CACHE_TTL_ANCHORED).catch((error) => {
                logger.warn({ error, key: cacheKey }, "Failed to set Redis cache for ipfs file entry");
            });
        }
        return fileEntry;
    }

    const root: IpfsEntry = { name: rootName, path: rootName, cid: rootCid, type: "directory", children: [] };

    type QueueItem = { parent: IpfsEntry; linkName: string; cid: string; path: string; size?: number; depth: number };
    const queue: QueueItem[] = [];

    const enqueueChildren = (parent: IpfsEntry, dagNode: any, parentPath: string, parentDepth: number) => {
        const links: Array<{ Name: string; Hash: unknown; Tsize?: number }> = dagNode?.Links ?? [];

        for (const link of links) {
            let childCid: string | undefined;
            if (typeof link.Hash === "string") {
                childCid = link.Hash;
            } else if (link.Hash && typeof (link.Hash as any)["/"] === "string") {
                childCid = (link.Hash as any)["/"] as string;
            }

            if (!childCid) {
                logger.warn({ link }, "Skipping link without valid CID string");
                continue;
            }

            const childPath = `${parentPath}/${link.Name}`;
            const childDepth = parentDepth + 1;
            if (maxDepth !== "full" && childDepth > maxDepth) {
                continue;
            }
            queue.push({
                parent,
                linkName: link.Name,
                cid: childCid,
                path: childPath,
                size: link.Tsize,
                depth: childDepth,
            });
        }
    };

    enqueueChildren(root, rootDag, root.path, 0);

    let index = 0;
    const workers: Promise<void>[] = [];

    const take = (): QueueItem | undefined => (index < queue.length ? queue[index++] : undefined);

    const worker = async () => {
        let item: QueueItem | undefined;
        // Drain queue; new children may extend queue while iterating
        // eslint-disable-next-line no-cond-assign
        while ((item = take()) !== undefined) {
            try {
                const dagNode: any = await fetchDagNode(item.cid);
                if (isUnixFsDirectory(dagNode)) {
                    const dirEntry: EnhancedIpfsEntry = {
                        name: item.linkName,
                        path: item.path,
                        cid: item.cid,
                        type: "directory",
                        children: [],
                        gateway: (item.parent as EnhancedIpfsEntry).gateway,
                    };
                    item.parent.children!.push(dirEntry);
                    if (maxDepth === "full" || item.depth < maxDepth) {
                        enqueueChildren(dirEntry, dagNode, item.path, item.depth);
                    }
                } else {
                    const fileEntry: EnhancedIpfsEntry = {
                        name: item.linkName,
                        path: item.path,
                        cid: item.cid,
                        size: item.size,
                        type: "file",
                        gateway: dagNode.gateway,
                    };
                    item.parent.children!.push(fileEntry);
                }
            } catch (error) {
                const errorTyped = error as {
                    message?: string;
                    response?: { data?: { Message?: string }; status?: number };
                };
                const errorMessage = errorTyped?.message || errorTyped?.response?.data?.Message;
                const isMissingContent = errorMessage?.includes("not found");

                logger.warn(
                    {
                        error: errorMessage,
                        cid: item?.cid,
                        path: item?.path,
                        isMissingContent,
                        status: errorTyped?.response?.status,
                    },
                    isMissingContent
                        ? "CID not found in any IPFS gateway; skipping child"
                        : "Failed to fetch DAG node; skipping child",
                );
            }
        }
    };

    for (let i = 0; i < maxConcurrency; i++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    if (redisService) {
        void redisService.setToCache(cacheKey, root, CACHE_TTL_ANCHORED).catch((error) => {
            logger.warn({ error, key: cacheKey }, "Failed to set Redis cache for ipfs tree");
        });
    }

    return root;
};

/**
 * Resolve a DPID to its manifest, extract the `root` component's CID, and return the full IPFS tree.
 */
export const getIpfsFolderTreeByDpid = async (
    dpid: number,
    options?: { versionIx?: number; concurrency?: number; depth?: number | "full" },
): Promise<IpfsEntry> => {
    const { versionIx } = options ?? {};

    const history = await resolveDpid(dpid, versionIx);
    if (!history?.manifest) {
        throw new Error("Failed to resolve manifest for dpid");
    }

    const manifestUrl = `${IPFS_GATEWAY}/${history.manifest}`;
    const manifest = (await fetch(manifestUrl).then(async (r) => await r.json())) as ResearchObjectV1;

    const rootComponent = manifest.components?.find((c) => c.name === "root");
    if (!rootComponent || !rootComponent.payload || typeof rootComponent.payload.cid !== "string") {
        throw new Error("Manifest does not contain a valid 'root' component with a CID");
    }

    return await getIpfsFolderTreeByCid(rootComponent.payload.cid, {
        rootName: "root",
        concurrency: options?.concurrency,
        depth: options?.depth,
    });
};
