import axios from "axios";
import type { ResearchObjectV1 } from "@desci-labs/desci-models";

import { CACHE_TTL_ANCHORED, DPID_ENV, IPFS_GATEWAY } from "../../../util/config.js";
import parentLogger from "../../../logger.js";
import { resolveDpid } from "../resolvers/dpid.js";
import { redisService } from "../../../redis.js";

const logger = parentLogger.child({ module: "/api/v2/data/getIpfsFolder" });

const IPFS_DAG_API_URL = process.env.IPFS_DAG_API_URL ?? "https://ipfs.desci.com/api/v0";
const MAGIC_UNIXFS_DIR_FLAG = "CAE"; // length-delimited protobuf [0x08, 0x01] => Directory

const getKeyForIpfsTree = (cid: string, rootName: string, depthKey: string) =>
    `resolver-${DPID_ENV}-ipfs-tree-${rootName}-${depthKey}-${cid}`;

export type IpfsEntry = {
    name: string;
    path: string;
    cid: string;
    size?: number;
    type: "file" | "directory";
    children?: IpfsEntry[];
};

/** Fetch a DAG node via IPFS HTTP API */
const fetchDagNode = async (arg: string): Promise<unknown> => {
    const url = `${IPFS_DAG_API_URL}/dag/get?arg=${encodeURIComponent(arg)}`;
    const { data } = await axios({ method: "POST", url });
    return data as unknown;
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
        const fileEntry: IpfsEntry = { name: rootName, path: rootName, cid: rootCid, type: "file" };
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
                    const dirEntry: IpfsEntry = {
                        name: item.linkName,
                        path: item.path,
                        cid: item.cid,
                        type: "directory",
                        children: [],
                    };
                    item.parent.children!.push(dirEntry);
                    if (maxDepth === "full" || item.depth < maxDepth) {
                        enqueueChildren(dirEntry, dagNode, item.path, item.depth);
                    }
                } else {
                    const fileEntry: IpfsEntry = {
                        name: item.linkName,
                        path: item.path,
                        cid: item.cid,
                        size: item.size,
                        type: "file",
                    };
                    item.parent.children!.push(fileEntry);
                }
            } catch (error) {
                logger.warn({ error, cid: item?.cid, path: item?.path }, "Failed to fetch DAG node; skipping child");
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
