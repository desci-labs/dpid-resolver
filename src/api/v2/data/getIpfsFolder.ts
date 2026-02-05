import axios from "axios";

import { CACHE_TTL_ANCHORED, DPID_ENV, IPFS_GATEWAY } from "../../../util/config.js";
import parentLogger from "../../../logger.js";
import { resolveDpid } from "../resolvers/dpid.js";
import { redisService } from "../../../redis.js";
import { getManifest } from "../../../util/manifests.js";
import { httpAgent, httpsAgent } from "../../../util/httpAgent.js";

const logger = parentLogger.child({ module: "/api/v2/data/getIpfsFolder" });

const IPFS_DAG_API_URL = process.env.IPFS_DAG_API_URL ?? "https://ipfs.desci.com/api/v0";
// Fallback IPFS gateways with DAG API support (if configured)
const IPFS_DAG_API_FALLBACK_URLS = process.env.IPFS_DAG_API_FALLBACK_URL
    ? process.env.IPFS_DAG_API_FALLBACK_URL.split(",")
    : ["https://pub.desci.com/api/v0"];
// Public HTTP gateways for fetching raw content when DAG API is unavailable
const PUBLIC_IPFS_GATEWAYS = process.env.PUBLIC_IPFS_GATEWAYS
    ? process.env.PUBLIC_IPFS_GATEWAYS.split(",")
    : [
          "https://pub.desci.com/ipfs",
          "https://ipfs.io/ipfs",
          "https://dweb.link/ipfs",
          "https://cloudflare-ipfs.com/ipfs",
      ];
const MAGIC_UNIXFS_DIR_FLAG = "CAE"; // length-delimited protobuf [0x08, 0x01] => Directory

/**
 * Check if a CID uses the raw codec (multicodec 0x55), meaning it's a leaf
 * file whose content IS the raw bytes — never a UnixFS directory.
 *
 * CIDv1 base32 encodes: <multibase><version><codec><multihash...>
 * "bafkrei" = base32lower 'b' + CIDv1 version 0x01 + raw codec 0x55 + sha2-256 0x1220.
 * Any CID starting with this prefix is guaranteed to be a raw file leaf.
 */
const isRawCodecCid = (cid: string): boolean => cid.startsWith("bafkrei");

// Cache key version history:
// v2: Initial versioned cache key
// v3: Invalidated to force re-fetch with public gateway fallback for missing files
// v4: Added public gateway fallback
// v5: Fixed caching of failed IPFS directory loads - only cache successful complete fetches
// v6: Added pub.desci.com fallback and fixed download URLs to use actual gateway that fetched files
const getKeyForIpfsTree = (cid: string, rootName: string, depthKey: string) =>
    `resolver-v6-${DPID_ENV}-ipfs-tree-${rootName}-${depthKey}-${cid}`;

// Per-CID DAG node cache: avoids redundant IPFS HTTP calls on retries
const getKeyForDagNode = (cid: string) => `resolver-v6-${DPID_ENV}-dag-node-${cid}`;
const DAG_NODE_CACHE_TTL = 4 * 60 * 60; // 4 hours

// Subtree cache: stores completed directory subtrees for progressive resolution
const getKeyForSubtree = (cid: string) => `resolver-v6-${DPID_ENV}-ipfs-subtree-full-${cid}`;

// Singleflight: coalesces concurrent requests for the same tree to prevent worker stacking
const inflightTrees = new Map<string, Promise<IpfsEntry>>();

/**
 * Fix paths in a cached subtree when grafting it at a new position in the tree.
 * CIDs are content-addressed so the tree structure is identical, but the absolute
 * paths depend on where in the parent tree the subtree is mounted.
 */
const fixSubtreePaths = (entry: IpfsEntry, basePath: string) => {
    entry.path = basePath;
    if (entry.children) {
        for (const child of entry.children) {
            fixSubtreePaths(child, `${basePath}/${child.name}`);
        }
    }
};

export type IpfsEntry = {
    name: string;
    path: string;
    cid: string;
    size?: number;
    type: "file" | "directory";
    children?: IpfsEntry[];
};

/**
 * Probe gateways with HEAD requests to find one that can serve a CID, without
 * downloading the body. Checks DAG API gateways first (via their /ipfs path),
 * then public HTTP gateways. Returns the gateway base URL on success, using
 * the DAG API URL for DAG API gateways so downstream consumers get the format
 * they expect.
 */
const probeGatewayForCid = async (cid: string): Promise<string | undefined> => {
    // Build probe list: DAG API gateways first (probed via /ipfs, returned as /api/v0),
    // then public HTTP gateways (probed and returned as-is)
    const probes: Array<{ probeUrl: string; returnUrl: string }> = [];
    for (const dagApiUrl of [IPFS_DAG_API_URL, ...IPFS_DAG_API_FALLBACK_URLS]) {
        probes.push({
            probeUrl: `${dagApiUrl.replace(/\/api\/v0$/, "/ipfs")}/${cid}`,
            returnUrl: dagApiUrl,
        });
    }
    for (const publicGw of PUBLIC_IPFS_GATEWAYS) {
        probes.push({
            probeUrl: `${publicGw}/${cid}`,
            returnUrl: publicGw,
        });
    }

    for (const { probeUrl, returnUrl } of probes) {
        try {
            const response = await axios({
                method: "HEAD",
                url: probeUrl,
                timeout: 15000,
                validateStatus: (status) => status === 200 || status === 404,
                httpAgent,
                httpsAgent,
            });

            if (response.status === 200) {
                logger.info({ cid, probeUrl, gateway: returnUrl }, "Content found via HEAD probe");
                return returnUrl;
            }
        } catch (error) {
            const axiosError = error as { response?: { status?: number }; message?: string };
            if (axiosError.response?.status === 404) {
                logger.debug({ cid, probeUrl }, "CID not found on gateway");
                continue;
            }
            logger.debug({ cid, probeUrl, error: axiosError.message }, "HEAD probe failed");
        }
    }
    return undefined;
};

/** Get JSON data from IPFS. When used for small files, shouldCache can be used to serve it
 * from redis
 */
export const ipfsCat = async (arg: string, shouldCache: boolean = false): Promise<unknown> => {
    const cacheKey = `resolver-${DPID_ENV}-cat-${arg}`;
    if (shouldCache) {
        const cachedContent = await redisService?.getFromCache(cacheKey);
        if (cachedContent) {
            logger.info({ cacheKey }, "Serving ipfsCat from cache");
            void redisService?.keyBump(cacheKey, CACHE_TTL_ANCHORED);
            return cachedContent;
        }
    }

    const url = `${IPFS_GATEWAY.replace(/\/ipfs$/, "")}/api/v0/cat?arg=${encodeURIComponent(arg)}`;
    logger.info({ url }, "Fetching IPFS content via public HTTP gateway");
    const { data } = await axios({
        method: "GET",
        url,
        responseType: "text",
        transformResponse: [(data) => data], // Prevent axios from auto-parsing
        httpAgent,
        httpsAgent,
    });

    // Attempt to parse as JSON, throw descriptive error if it fails
    try {
        const parsed = JSON.parse(data);
        if (shouldCache) {
            void redisService?.setToCache(cacheKey, parsed, CACHE_TTL_ANCHORED);
        }
        return parsed;
    } catch (e) {
        const preview = typeof data === "string" ? data.slice(0, 100) : String(data);
        throw new Error(`ipfsCat: expected JSON response but got: "${preview}..."`);
    }
};

export type EnhancedIpfsEntry = IpfsEntry & { gateway?: string; cid: string; name: string };

/** Fetch a DAG node via IPFS HTTP API with retry logic and fallback gateway support */
export const fetchDagNode = async (arg: string, retries = 2): Promise<EnhancedIpfsEntry> => {
    // Check per-CID cache to avoid redundant IPFS fetches on retries
    const cacheKey = getKeyForDagNode(arg);
    const cached = await redisService?.getFromCache<EnhancedIpfsEntry>(cacheKey);
    if (cached) {
        logger.info({ cacheKey }, "Serving dag node from cache");
        void redisService?.keyBump(cacheKey, DAG_NODE_CACHE_TTL);
        return cached;
    }

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
                    httpAgent,
                    httpsAgent,
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
                const result = { ...data, gateway: chosenGateway } as EnhancedIpfsEntry;
                void redisService?.setToCache(cacheKey, result, DAG_NODE_CACHE_TTL);
                return result;
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

    logger.debug({ cid: arg }, "All DAG API gateways failed, probing for content via HEAD");
    const probeGateway = await probeGatewayForCid(arg);

    if (probeGateway) {
        logger.info(
            {
                cid: arg,
                gateway: probeGateway,
                note: "Content found via HEAD probe - consider pinning to ipfs.desci.com",
            },
            "Using probed gateway fallback for missing CID",
        );
        const result: EnhancedIpfsEntry = {
            name: "",
            path: "",
            cid: arg,
            type: "file",
            gateway: probeGateway,
        };
        void redisService?.setToCache(cacheKey, result, DAG_NODE_CACHE_TTL);
        return result;
    }

    // Content not found anywhere
    throw new Error(`Failed to fetch DAG node ${arg} from all available gateways: ${errorMsg}`);
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const isUnixFsDirectory = (dagNode: any): boolean => dagNode?.Data?.["/"]?.bytes === MAGIC_UNIXFS_DIR_FLAG;

/**
 * Recursively build a folder tree starting from a UnixFS root CID.
 * Limits concurrent DAG fetches to avoid overloading the IPFS gateway.
 *
 * Uses singleflight to prevent thundering herd (concurrent requests for the same
 * tree share one resolution), DFS traversal order (subtrees complete before siblings),
 * and progressive subtree caching (completed subtrees are cached individually so that
 * retries after partial failures make forward progress).
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

    // 1. Check full-tree cache
    const cached = await redisService?.getFromCache<IpfsEntry>(cacheKey);
    if (cached) {
        void redisService?.keyBump(cacheKey, CACHE_TTL_ANCHORED);
        return cached;
    }

    // 2. Singleflight: if another request is already resolving this exact tree, join it
    //    instead of spawning a new set of workers (prevents worker stacking on retries)
    const inflight = inflightTrees.get(cacheKey);
    if (inflight) {
        logger.info({ cacheKey, rootCid }, "Joining in-flight tree resolution");
        return inflight;
    }

    // 3. Start new resolution and register in singleflight map
    const promise = resolveIpfsTree(rootCid, rootName, maxConcurrency, maxDepth, cacheKey);
    inflightTrees.set(cacheKey, promise);
    promise.finally(() => inflightTrees.delete(cacheKey)).catch(() => {});
    return promise;
};

/**
 * Internal: resolve an IPFS tree using DFS traversal with progressive subtree caching.
 *
 * DFS (depth-first) traversal means subtrees complete before sibling branches are explored.
 * This enables caching completed subtrees individually, so that even if the full tree
 * resolution times out, progress is preserved for the next attempt.
 */
async function resolveIpfsTree(
    rootCid: string,
    rootName: string,
    maxConcurrency: number,
    maxDepth: number | "full",
    cacheKey: string,
): Promise<IpfsEntry> {
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
        void redisService?.setToCache(cacheKey, fileEntry, CACHE_TTL_ANCHORED);
        return fileEntry;
    }

    const root: IpfsEntry = { name: rootName, path: rootName, cid: rootCid, type: "directory", children: [] };

    type QueueItem = {
        parent: IpfsEntry;
        linkName: string;
        cid: string;
        path: string;
        size?: number;
        depth: number;
        gateway?: string;
    };
    const queue: QueueItem[] = [];
    const useSubtreeCache = maxDepth === "full";

    // --- Subtree completion tracking ---
    // Each directory tracks how many of its children are still pending resolution.
    // When a directory's pending count reaches 0, its subtree is fully resolved and
    // can be cached. Completion propagates upward to the parent.
    const pendingChildren = new Map<IpfsEntry, number>();
    const parentOf = new Map<IpfsEntry, IpfsEntry>();
    const subtreeHasError = new Set<IpfsEntry>();
    const cachedSubtreeKeys: string[] = [];

    const onChildResolved = (parent: IpfsEntry, childHadError: boolean) => {
        if (childHadError) subtreeHasError.add(parent);
        const remaining = (pendingChildren.get(parent) ?? 1) - 1;
        pendingChildren.set(parent, remaining);

        if (remaining === 0) {
            const hasError = subtreeHasError.has(parent);

            // Cache this completed subtree (skip root; it gets the full-tree cache)
            if (useSubtreeCache && redisService && !hasError && parent !== root) {
                const subtreeKey = getKeyForSubtree(parent.cid);
                cachedSubtreeKeys.push(subtreeKey);
                void redisService?.setToCache(subtreeKey, parent, CACHE_TTL_ANCHORED);
            }

            // Propagate completion to grandparent
            const grandparent = parentOf.get(parent);
            if (grandparent) {
                onChildResolved(grandparent, hasError);
            }
        }
    };

    const enqueueChildren = (parent: IpfsEntry, dagNode: any, parentPath: string, parentDepth: number): number => {
        const links: Array<{ Name: string; Hash: unknown; Tsize?: number }> = dagNode?.Links ?? [];
        // The gateway that served this directory's DAG node — its children are
        // very likely available on the same gateway since IPFS pins entire DAGs.
        const dagGateway: string | undefined = dagNode?.gateway;
        let enqueued = 0;

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
                gateway: dagGateway,
            });
            enqueued++;
        }

        return enqueued;
    };

    const rootChildCount = enqueueChildren(root, rootDag, root.path, 0);
    pendingChildren.set(root, rootChildCount);

    const workers: Promise<void>[] = [];
    let hasErrors = false;

    // DFS: pop from end of array (LIFO/stack) so workers explore depth-first.
    // This completes subtrees before moving to sibling branches, enabling progressive caching.
    const take = (): QueueItem | undefined => (queue.length > 0 ? queue.pop() : undefined);

    const worker = async () => {
        let item: QueueItem | undefined;
        // Drain stack; new children may extend it while iterating
        // eslint-disable-next-line no-cond-assign
        while ((item = take()) !== undefined) {
            try {
                // Check subtree cache: if this CID's full subtree was resolved in a previous
                // (possibly timed-out) request, graft it directly instead of re-traversing
                if (useSubtreeCache) {
                    const subtreeKey = getKeyForSubtree(item.cid);
                    const cachedSubtree = await redisService?.getFromCache<IpfsEntry>(subtreeKey);
                    if (cachedSubtree) {
                        cachedSubtree.name = item.linkName;
                        fixSubtreePaths(cachedSubtree, item.path);
                        item.parent.children!.push(cachedSubtree);
                        cachedSubtreeKeys.push(subtreeKey);
                        onChildResolved(item.parent, false);
                        continue;
                    }
                }

                // Raw-codec CIDs are always leaf files; probe for a serving
                // gateway via HEAD instead of downloading the full content.
                if (isRawCodecCid(item.cid)) {
                    const gateway = await probeGatewayForCid(item.cid);
                    const fileEntry: EnhancedIpfsEntry = {
                        name: item.linkName,
                        path: item.path,
                        cid: item.cid,
                        size: item.size,
                        type: "file",
                        gateway,
                    };
                    item.parent.children!.push(fileEntry);
                    onChildResolved(item.parent, false);
                    continue;
                }

                const dagNode: any = await fetchDagNode(item.cid);
                if (isUnixFsDirectory(dagNode)) {
                    const dirEntry: EnhancedIpfsEntry = {
                        name: item.linkName,
                        path: item.path,
                        cid: item.cid,
                        type: "directory",
                        children: [],
                        gateway: dagNode.gateway,
                    };
                    item.parent.children!.push(dirEntry);

                    const childCount = enqueueChildren(dirEntry, dagNode, item.path, item.depth);
                    if (childCount > 0) {
                        pendingChildren.set(dirEntry, childCount);
                        parentOf.set(dirEntry, item.parent);
                    } else {
                        // Empty or depth-limited directory: immediately complete
                        onChildResolved(item.parent, false);
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
                    onChildResolved(item.parent, false);
                }
            } catch (error) {
                hasErrors = true;
                onChildResolved(item.parent, true);
                const errorTyped = error as {
                    message?: string;
                    response?: { data?: { Message?: string }; status?: number };
                };
                const errorMessage = errorTyped?.message || errorTyped?.response?.data?.Message;
                const isMissingContent = errorMessage?.includes("not found");

                logger.warn(
                    {
                        error: errorMessage,
                        cid: item.cid,
                        path: item.path,
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

    // Cache full tree if no errors, and clean up now-redundant subtree cache entries
    if (!hasErrors) {
        void redisService?.setToCache(cacheKey, root, CACHE_TTL_ANCHORED).then((wasSet) => {
            if (wasSet) {
                // Full tree cached — subtree entries are now redundant, clean them up
                void redisService?.del(...cachedSubtreeKeys);
            }
        });
    } else {
        logger.info(
            { cacheKey, rootCid },
            "Skipping full tree cache due to errors (subtrees may be cached individually)",
        );
    }

    return root;
}

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

    const cid = history.manifest;
    const manifest = await getManifest(cid);
    if (!manifest) {
        throw new Error("Could not get manifest");
    }

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
