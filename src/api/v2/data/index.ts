import { Router, type Request, type Response } from "express";

import parentLogger, { serializeError } from "../../../logger.js";
import analytics, { LogEventType } from "../../../analytics.js";
import { isDpid } from "../../../util/validation.js";
import { getIpfsFolderTreeByCid, getIpfsFolderTreeByDpid, type IpfsEntry } from "./getIpfsFolder.js";

const MODULE_PATH = "/api/v2/data" as const;
const logger = parentLogger.child({ module: MODULE_PATH });

const router = Router();

type IpfsEntryResponse =
    | IpfsEntry
    | { error: string; details?: unknown }
    | { depth: number; note: string; tree: IpfsEntry };

const parseVersionIx = (maybe: string | undefined): number | undefined => {
    if (!maybe) return undefined;
    if (/^v?\d+$/.test(maybe)) {
        if (maybe.startsWith("v")) {
            const ix = parseInt(maybe.slice(1));
            return isNaN(ix) ? undefined : ix - 1;
        }
        const ix = parseInt(maybe);
        return isNaN(ix) ? undefined : ix;
    }
    return undefined;
};

/**
 * @openapi
 * /v2/data/dpid/{dpid}:
 *   get:
 *     tags: [Data]
 *     summary: Get IPFS folder tree for the research object's root by dPID
 *     description: |
 *       Resolves the given dPID to its manifest and returns the directory tree for the `root` component's CID.
 *       Use `depth` to limit recursion for performance; use `full` for complete traversal.
 *     parameters:
 *       - in: path
 *         name: dpid
 *         required: true
 *         schema:
 *           type: string
 *           pattern: "^\\d+$"
 *         description: The dPID identifier (numeric)
 *       - in: query
 *         name: version
 *         schema:
 *           type: string
 *           example: v3
 *         description: Specific version index (e.g., `v3` or `2`) to resolve before reading the root CID
 *       - in: query
 *         name: concurrency
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 16
 *           default: 8
 *         description: Maximum number of concurrent DAG fetches
 *       - in: query
 *         name: depth
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [full]
 *             - type: integer
 *               minimum: 0
 *         description: Maximum directory depth to traverse. Use `full` for complete traversal, or a number (0=root only).
 *     responses:
 *       200:
 *         description: Folder tree
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IpfsEntry'
 *       400:
 *         description: Invalid dpid
 *       500:
 *         description: Failed to build folder tree
 */
router.get(
    "/dpid/:dpid",
    async (
        req: Request<{ dpid: string }, unknown, undefined, { version?: string; concurrency?: string; depth?: string }>,
        res: Response<IpfsEntryResponse>,
    ) => {
        const { dpid } = req.params;
        const { version, concurrency, depth } = req.query;

        if (!isDpid(dpid)) {
            return res.status(400).send({ error: `invalid dpid: '${dpid}'` });
        }

        const versionIx = parseVersionIx(version);
        const conc = concurrency ? Math.max(1, Math.min(parseInt(concurrency), 16)) : undefined;

        let parsedDepth: number | "full" | undefined = undefined;
        if (typeof depth === "string") {
            if (depth === "full") {
                parsedDepth = "full";
            } else {
                const d = parseInt(depth);
                if (!isNaN(d) && d >= 0) parsedDepth = d;
            }
        }

        try {
            const dpidNum = parseInt(dpid);
            const tree = await getIpfsFolderTreeByDpid(dpidNum, {
                versionIx,
                concurrency: conc,
                depth: parsedDepth,
            });
            const responsePayload =
                parsedDepth === undefined
                    ? { depth: 1, note: "call with ?depth=full to get full directory structure (may be slow)", tree }
                    : tree;

            void analytics.log({
                dpid: dpidNum,
                version: typeof versionIx === "number" ? versionIx : -1,
                eventType: LogEventType.DPID_GET,
                extra: { path: req.path, query: req.query, depth: parsedDepth ?? 1 },
            });
            return res.status(200).send(responsePayload);
        } catch (error) {
            logger.error(
                { error: serializeError(error as Error), dpid, versionIx },
                "failed to build folder tree by dpid",
            );
            return res.status(500).send({ error: "failed to build folder tree by dpid" });
        }
    },
);

/**
 * @openapi
 * /v2/data/cid/{cid}:
 *   get:
 *     tags: [Data]
 *     summary: Get IPFS folder tree by root CID
 *     description: |
 *       Returns the directory tree for a given UnixFS root CID. Use `depth` to limit recursion for performance; use `full` for a complete traversal.
 *     parameters:
 *       - in: path
 *         name: cid
 *         required: true
 *         schema:
 *           type: string
 *         description: Root CID of a UnixFS directory or file
 *       - in: query
 *         name: rootName
 *         schema:
 *           type: string
 *           default: root
 *         description: Custom root label in the returned tree
 *       - in: query
 *         name: concurrency
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 16
 *           default: 8
 *         description: Maximum number of concurrent DAG fetches
 *       - in: query
 *         name: depth
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [full]
 *             - type: integer
 *               minimum: 0
 *         description: Maximum directory depth to traverse. Use `full` for complete traversal, or a number (0=root only).
 *     responses:
 *       200:
 *         description: Folder tree
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/IpfsEntry'
 *       500:
 *         description: Failed to build folder tree
 */
/**
 * @openapi
 * /v2/data/dpid/{dpid}/*:
 *   get:
 *     tags: [Data]
 *     summary: Get IPFS folder tree for a specific path within a dPID
 *     description: |
 *       Resolves the given dPID and navigates to a specific path within the root component.
 *       For example: /v2/data/dpid/827/root/code will return just the 'code' directory.
 *     parameters:
 *       - in: path
 *         name: dpid
 *         required: true
 *         schema:
 *           type: string
 *         description: The dPID identifier followed by the path (e.g., 827/root/code)
 *       - in: query
 *         name: depth
 *         schema:
 *           oneOf:
 *             - type: string
 *               enum: [full]
 *             - type: integer
 *               minimum: 0
 *         description: Maximum directory depth to traverse
 *     responses:
 *       200:
 *         description: Folder tree at the specified path
 *       404:
 *         description: Path not found
 */
router.get(
    "/dpid/:dpid/*",
    async (
        req: Request<{ dpid: string; "0": string }, unknown, undefined, { depth?: string; concurrency?: string }>,
        res: Response<IpfsEntryResponse>,
    ) => {
        const { dpid } = req.params;
        const { depth, concurrency } = req.query;

        // Extract the path after /dpid/{dpid}/
        const fullPath = req.params["0"];
        if (!fullPath) {
            return res.status(400).send({ error: "path is required after dpid" });
        }

        // Split and filter the path, removing empty segments
        let pathParts = fullPath.split("/").filter((p) => p.length > 0);

        // Strip leading "root" if present since the tree root is already named "root"
        if (pathParts.length > 0 && pathParts[0] === "root") {
            pathParts = pathParts.slice(1);
        }

        if (!isDpid(dpid)) {
            return res.status(400).send({ error: `invalid dpid: '${dpid}'` });
        }

        let parsedDepth: number | "full" | undefined = undefined;
        if (typeof depth === "string") {
            if (depth === "full") {
                parsedDepth = "full";
            } else {
                const d = parseInt(depth, 10);
                if (!Number.isNaN(d) && d >= 0) parsedDepth = d;
            }
        }

        let conc: number | undefined = undefined;
        if (concurrency) {
            const parsed = parseInt(concurrency, 10);
            if (!Number.isNaN(parsed)) {
                conc = Math.max(1, Math.min(parsed, 16));
            }
        }

        try {
            const dpidNum = parseInt(dpid);
            // Get the full tree first
            const tree = await getIpfsFolderTreeByDpid(dpidNum, {
                concurrency: conc,
                depth: "full", // Need full tree to navigate
            });

            // Navigate to the requested path
            let current: IpfsEntry | undefined = tree;
            for (const part of pathParts) {
                if (!current || current.type !== "directory" || !current.children) {
                    return res.status(404).send({ error: `path not found: ${fullPath}` });
                }
                current = current.children.find((child) => child.name === part);
                if (!current) {
                    return res.status(404).send({ error: `path not found: ${fullPath}` });
                }
            }

            // If depth is specified, we might want to re-fetch with that depth
            // For now, just return what we found
            const responsePayload =
                parsedDepth === undefined
                    ? {
                          depth: 1,
                          note: "call with ?depth=full to get full directory structure (may be slow)",
                          tree: current,
                      }
                    : current;

            void analytics.log({
                dpid: dpidNum,
                version: -1,
                eventType: LogEventType.DPID_GET,
                extra: { path: req.path, query: req.query, subpath: fullPath, depth: parsedDepth ?? 1 },
            });

            return res.status(200).send(responsePayload);
        } catch (error) {
            logger.error(
                { error: serializeError(error as Error), dpid, path: fullPath },
                "failed to navigate to path in dpid",
            );
            return res.status(500).send({ error: "failed to navigate to path" });
        }
    },
);

router.get(
    "/cid/:cid",
    async (
        req: Request<{ cid: string }, unknown, undefined, { rootName?: string; concurrency?: string; depth?: string }>,
        res: Response<IpfsEntryResponse>,
    ) => {
        const { cid } = req.params;
        const { rootName, concurrency, depth } = req.query;

        const conc = concurrency ? Math.max(1, Math.min(parseInt(concurrency), 16)) : undefined;

        let parsedDepth: number | "full" | undefined = undefined;
        if (typeof depth === "string") {
            if (depth === "full") {
                parsedDepth = "full";
            } else {
                const d = parseInt(depth);
                if (!isNaN(d) && d >= 0) parsedDepth = d;
            }
        }

        try {
            const tree = await getIpfsFolderTreeByCid(cid, {
                rootName: rootName || cid,
                concurrency: conc,
                depth: parsedDepth,
            });
            const responsePayload =
                parsedDepth === undefined
                    ? { depth: 1, note: "call with ?depth=full to get full directory structure (may be slow)", tree }
                    : tree;

            void analytics.log({
                dpid: 0,
                version: -1,
                eventType: LogEventType.DPID_GET,
                extra: { path: req.path, query: req.query, cid, depth: parsedDepth ?? 1 },
            });
            return res.status(200).send(responsePayload);
        } catch (error) {
            logger.error({ error: serializeError(error as Error), cid }, "failed to build folder tree by cid");
            return res.status(500).send({ error: "failed to build folder tree by cid" });
        }
    },
);

export default router;

/**
 * @openapi
 * components:
 *   schemas:
 *     IpfsEntry:
 *       type: object
 *       required: [name, path, cid, type]
 *       properties:
 *         name:
 *           type: string
 *           description: File or directory name
 *         path:
 *           type: string
 *           description: Path from the root label to this entry
 *         cid:
 *           type: string
 *           description: IPFS CID
 *         size:
 *           type: integer
 *           nullable: true
 *           description: File size if known
 *         type:
 *           type: string
 *           enum: [file, directory]
 *         children:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/IpfsEntry'
 */
