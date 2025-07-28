import { Router } from "express";
import { objectQueryHandler } from "./queries/objects.js";
import { historyQueryHandler } from "./queries/history.js";
import { dpidListHandler } from "./queries/dpids.js";

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     ResearchObject:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Stream ID
 *         owner:
 *           type: string
 *           description: Owner DID PKH
 *         manifest:
 *           type: string
 *           description: Manifest CID
 *         title:
 *           type: string
 *           description: Research object title
 *     ResearchObjectHistory:
 *       type: object
 *       properties:
 *         version:
 *           type: string
 *           description: Version identifier
 *         manifest:
 *           type: string
 *           description: Manifest CID for this version
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Timestamp of version
 *     ResearchObjectQueryError:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *         details:
 *           type: object
 *           description: Detailed error information
 *         params:
 *           type: object
 *           description: Request parameters
 *         path:
 *           type: string
 *           description: API path where error occurred
 */

/**
 * @swagger
 * /v2/query/objects:
 *   get:
 *     tags:
 *       - Query
 *     summary: Query for all research objects
 *     responses:
 *       200:
 *         description: List of research objects
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ResearchObject'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 */
router.get("/objects", objectQueryHandler);

/**
 * @swagger
 * /v2/query/history/{id}:
 *   get:
 *     tags:
 *       - Query
 *     summary: Query for the history of a single research object
 *     description: |
 *       Query the version history of a single research object using either:
 *       - dPID (e.g. 46)
 *       - stream ID (e.g. kjzl6kcym7w8y92di94io797nmzrprs5ndmcqtugbtnd27kko22fuyev08r4682)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: |
 *           Either a dPID or stream ID to query.
 *           Examples:
 *           - dPID: 46
 *           - stream ID: kjzl6kcym7w8y92di94io797nmzrprs5ndmcqtugbtnd27kko22fuyev08r4682
 *     responses:
 *       200:
 *         description: Research object history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                   description: Stream ID
 *                 owner:
 *                   type: string
 *                   description: Owner DID PKH
 *                 manifest:
 *                   type: string
 *                   description: Latest manifest CID
 *                 versions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ResearchObjectHistory'
 *       400:
 *         description: Invalid dPID or stream ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *       404:
 *         description: dPID or stream not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 * /v2/query/history:
 *   post:
 *     tags:
 *       - Query
 *     summary: Query for the history of multiple research objects
 *     description: |
 *       Query the version history of multiple research objects using a list of IDs.
 *       Each ID can be either a dPID or stream ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of dPIDs or stream IDs
 *                 example: ["46", "kjzl6kcym7w8y92di94io797nmzrprs5ndmcqtugbtnd27kko22fuyev08r4682"]
 *             required:
 *               - ids
 *     responses:
 *       200:
 *         description: Array of research object histories
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: Stream ID
 *                   owner:
 *                     type: string
 *                     description: Owner DID PKH
 *                   manifest:
 *                     type: string
 *                     description: Latest manifest CID
 *                   versions:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/ResearchObjectHistory'
 *       400:
 *         description: Invalid request body or ID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *       404:
 *         description: One or more objects not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 */
router.use("/history/:id?", historyQueryHandler);
router.post("/history", historyQueryHandler);

/** Query for all DPIDs with pagination and version info */
router.get("/dpids", dpidListHandler);

export default router;
