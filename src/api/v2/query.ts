import { Router } from "express";
import { objectQueryHandler } from "./queries/objects.js";
import { historyQueryHandler } from "./queries/history.js";

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
router.use("/objects", objectQueryHandler);

/**
 * @swagger
 * /v2/query/history/{id}:
 *   get:
 *     tags:
 *       - Query
 *     summary: Query for the history of one or more research objects
 *     description: |
 *       Query the version history of research objects. Can be called in two ways:
 *       1. Using path parameter to query a single object
 *       2. Using request body to query multiple objects
 *
 *       Each object is referenced by either:
 *       - dPID (e.g. 46)
 *       - stream ID (e.g. kjzl6kcym7w8y92di94io797nmzrprs5ndmcqtugbtnd27kko22fuyev08r4682)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: false
 *         schema:
 *           oneOf:
 *             - type: string
 *               description: Stream ID
 *             - type: integer
 *               description: dPID
 *         description: Optional ID to get history for specific object (either stream ID or dPID)
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   oneOf:
 *                     - type: string
 *                       description: Stream ID
 *                     - type: integer
 *                       description: dPID
 *                 description: Array of IDs to query (either stream IDs or dPIDs)
 *     responses:
 *       200:
 *         description: History of research objects
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 versions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       version:
 *                         type: string
 *                         description: Version identifier
 *                       manifest:
 *                         type: string
 *                         description: Manifest CID for this version
 *                       timestamp:
 *                         type: string
 *                         format: date-time
 *                         description: Timestamp of version
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *       404:
 *         description: Object not found
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

export default router;
