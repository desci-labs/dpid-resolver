import { Router } from "express";
import { objectQueryHandler } from "./queries/objects.js";
import { historyQueryHandler } from "./queries/history.js";
import { dpidListHandler } from "./queries/dpids.js";
import { ownerQueryHandler } from "./queries/owner.js";

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
 *     DpidVersion:
 *       type: object
 *       properties:
 *         index:
 *           type: integer
 *           description: Zero-based version index
 *         cid:
 *           type: string
 *           description: IPFS CID for this version
 *         time:
 *           type: integer
 *           nullable: true
 *           description: Unix timestamp of version (null if pending)
 *         resolveUrl:
 *           type: string
 *           description: URL to resolve this specific version
 *     ManifestMetadata:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *           description: Research object title
 *         description:
 *           type: string
 *           description: Research object description
 *         authors:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               orcid:
 *                 type: string
 *           description: Array of authors
 *         keywords:
 *           type: array
 *           items:
 *             type: string
 *           description: Research keywords/tags
 *         license:
 *           type: string
 *           description: License information
 *     DpidQueryResult:
 *       type: object
 *       properties:
 *         dpid:
 *           type: integer
 *           description: DPID number
 *         owner:
 *           type: string
 *           description: Owner DID PKH address
 *         latestCid:
 *           type: string
 *           description: Latest manifest CID
 *         versionCount:
 *           type: integer
 *           description: Total number of versions
 *         source:
 *           type: string
 *           enum: [ceramic, legacy]
 *           description: Data source type
 *         versions:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DpidVersion'
 *           description: Version history (only included when history=true)
 *         metadata:
 *           $ref: '#/components/schemas/ManifestMetadata'
 *           description: Manifest metadata (only included when metadata=true)
 *         links:
 *           type: object
 *           properties:
 *             history:
 *               type: string
 *               description: URL to get full history
 *             latest:
 *               type: string
 *               description: URL to resolve latest version
 *             raw:
 *               type: string
 *               description: URL to get raw manifest
 *     DpidListResponse:
 *       type: object
 *       properties:
 *         dpids:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DpidQueryResult'
 *           description: Array of DPID results
 *         pagination:
 *           type: object
 *           properties:
 *             page:
 *               type: integer
 *               description: Current page number
 *             size:
 *               type: integer
 *               description: Number of results per page
 *             total:
 *               type: integer
 *               description: Total number of DPIDs
 *             hasNext:
 *               type: boolean
 *               description: Whether there are more pages
 *             hasPrev:
 *               type: boolean
 *               description: Whether there are previous pages
 *             links:
 *               type: object
 *               properties:
 *                 self:
 *                   type: string
 *                   description: Current page URL
 *                 first:
 *                   type: string
 *                   description: First page URL
 *                 prev:
 *                   type: string
 *                   nullable: true
 *                   description: Previous page URL
 *                 next:
 *                   type: string
 *                   nullable: true
 *                   description: Next page URL
 *                 last:
 *                   type: string
 *                   description: Last page URL
 *                 withHistory:
 *                   type: string
 *                   nullable: true
 *                   description: URL with version history included
 *                 withoutHistory:
 *                   type: string
 *                   nullable: true
 *                   description: URL without version history
 *                 withMetadata:
 *                   type: string
 *                   nullable: true
 *                   description: URL with manifest metadata included
 *                 withoutMetadata:
 *                   type: string
 *                   nullable: true
 *                   description: URL without manifest metadata
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

/**
 * @swagger
 * /v2/query/dpids:
 *   get:
 *     tags:
 *       - Query
 *     summary: List all DPIDs with pagination, version history, and metadata
 *     description: |
 *       Retrieve a paginated list of all DPIDs in the system. This endpoint is ideal for:
 *       - **Browse pages**: Get overview of all research objects with optional metadata
 *       - **Search implementations**: Paginate through DPIDs with filtering
 *       - **Analytics**: Understand publication patterns and volume
 *
 *       ## Key Features
 *       - **Pagination**: Navigate through large DPID collections efficiently
 *       - **Optional History**: Include complete version history per DPID (`history=true`)
 *       - **Optional Metadata**: Resolve manifest metadata like titles, authors (`metadata=true`)
 *       - **Field Selection**: Choose specific metadata fields (`fields=title,authors`)
 *       - **Sorting**: Control order with `sort=asc|desc` (newest first by default)
 *       - **Smart Links**: Self-documenting pagination URLs for discovery
 *
 *       ## Common Usage Patterns
 *
 *       **Browse Page (Basic)**:
 *       ```
 *       GET /v2/query/dpids?page=1&size=20&metadata=true&fields=title,authors
 *       ```
 *
 *       **Browse Page (with History)**:
 *       ```
 *       GET /v2/query/dpids?page=1&size=10&history=true&metadata=true
 *       ```
 *
 *       **Analytics/Stats**:
 *       ```
 *       GET /v2/query/dpids?page=1&size=100&sort=asc
 *       ```
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number (1-based)
 *       - in: query
 *         name: size
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of DPIDs per page (max 100)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order by DPID number (desc = newest first)
 *       - in: query
 *         name: history
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include complete version history for each DPID
 *         example: true
 *       - in: query
 *         name: metadata
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Resolve IPFS manifest metadata (authors, title, etc.)
 *         example: true
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *           default: "title,authors"
 *         description: |
 *           Comma-separated metadata fields to include when metadata=true.
 *           Available: title, authors, description, keywords, license
 *         example: "title,authors,description"
 *     responses:
 *       200:
 *         description: Paginated list of DPIDs with optional history and metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DpidListResponse'
 *             examples:
 *               basic:
 *                 summary: Basic pagination without history or metadata
 *                 value:
 *                   dpids:
 *                     - dpid: 557
 *                       owner: "0x1234567890abcdef1234567890abcdef12345678"
 *                       latestCid: "bafkreiasyoawbtjotfckd7yi33t4rxidiqusrwj6g2hb2gsczw35nlt4we"
 *                       versionCount: 1
 *                       source: "ceramic"
 *                       links:
 *                         history: "http://localhost:5461/api/v2/query/history/557"
 *                         latest: "http://localhost:5461/api/v2/resolve/dpid/557"
 *                         raw: "http://localhost:5461/557?raw"
 *                   pagination:
 *                     page: 1
 *                     size: 1
 *                     total: 557
 *                     hasNext: true
 *                     hasPrev: false
 *                     links:
 *                       self: "http://localhost:5461/api/v2/query/dpids?page=1&size=1"
 *                       first: "http://localhost:5461/api/v2/query/dpids?page=1&size=1"
 *                       next: "http://localhost:5461/api/v2/query/dpids?page=2&size=1"
 *                       last: "http://localhost:5461/api/v2/query/dpids?page=557&size=1"
 *                       withHistory: "http://localhost:5461/api/v2/query/dpids?page=1&size=1&history=true"
 *                       withMetadata: "http://localhost:5461/api/v2/query/dpids?page=1&size=1&metadata=true&fields=title,authors"
 *               withMetadata:
 *                 summary: With manifest metadata resolved
 *                 value:
 *                   dpids:
 *                     - dpid: 557
 *                       owner: "0x1234567890abcdef1234567890abcdef12345678"
 *                       latestCid: "bafkreiasyoawbtjotfckd7yi33t4rxidiqusrwj6g2hb2gsczw35nlt4we"
 *                       versionCount: 1
 *                       source: "ceramic"
 *                       metadata:
 *                         title: "Sleep Duration Research Proposal"
 *                         authors:
 *                           - name: "John Doe"
 *                             orcid: "0000-0000-0000-0000"
 *                       links:
 *                         history: "http://localhost:5461/api/v2/query/history/557"
 *                         latest: "http://localhost:5461/api/v2/resolve/dpid/557"
 *                         raw: "http://localhost:5461/557?raw"
 *                   pagination:
 *                     page: 1
 *                     size: 1
 *                     total: 557
 *                     hasNext: true
 *                     hasPrev: false
 *                     links:
 *                       self: "http://localhost:5461/api/v2/query/dpids?page=1&size=1&metadata=true&fields=title,authors"
 *                       withoutMetadata: "http://localhost:5461/api/v2/query/dpids?page=1&size=1"
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *             examples:
 *               invalidPage:
 *                 summary: Invalid page parameter
 *                 value:
 *                   error: "Invalid page parameter"
 *                   details: "Page must be a positive integer"
 *                   params: { page: "0", size: "20" }
 *                   path: "/api/v2/query/dpids"
 *               invalidSize:
 *                 summary: Invalid size parameter
 *                 value:
 *                   error: "Invalid size parameter"
 *                   details: "Size must be between 1 and 100"
 *                   params: { page: "1", size: "200" }
 *                   path: "/api/v2/query/dpids"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 */
router.get("/dpids", dpidListHandler);

/**
 * @swagger
 * /v2/query/owner/{id}:
 *   get:
 *     tags:
 *       - Query
 *     summary: Query for research objects by owner
 *     description: |
 *       Retrieve all research objects owned by a specific address. This endpoint:
 *       - Fetches all research objects from the system
 *       - Filters them by the specified owner address
 *       - Supports both full DID format and plain address format
 *
 *       ## Owner ID Format
 *       The owner ID can be provided in two formats:
 *       - **Plain address**: `0x90b2c654f18e491a566d6a38c491cf82745e5987`
 *       - **Full DID**: `did:pkh:eip155:1337:0x90b2c654f18e491a566d6a38c491cf82745e5987`
 *
 *       The endpoint will match both formats automatically.
 *
 *       ## Use Cases
 *       - **User dashboards**: Display all research objects for a specific researcher
 *       - **Profile pages**: Show publication history for an address
 *       - **Analytics**: Track research output by author/institution
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: |
 *           Owner address or DID to filter by.
 *           Examples:
 *           - Plain address: 0x90b2c654f18e491a566d6a38c491cf82745e5987
 *           - Full DID: did:pkh:eip155:1337:0x90b2c654f18e491a566d6a38c491cf82745e5987
 *         example: "0x90b2c654f18e491a566d6a38c491cf82745e5987"
 *     responses:
 *       200:
 *         description: List of research objects owned by the specified address
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ResearchObject'
 *             examples:
 *               success:
 *                 summary: Successful response with research objects
 *                 value:
 *                   - id: "kjzl6kcym7w8y92di94io797nmzrprs5ndmcqtugbtnd27kko22fuyev08r4682"
 *                     owner: "did:pkh:eip155:1337:0x90b2c654f18e491a566d6a38c491cf82745e5987"
 *                     manifest: "bafkreiasyoawbtjotfckd7yi33t4rxidiqusrwj6g2hb2gsczw35nlt4we"
 *                     title: "Research Object Title"
 *                   - id: "kjzl6kcym7w8y8zxcv9io123nmzrprs5ndmcqtugbtnd27kko22fuyev08r9876"
 *                     owner: "did:pkh:eip155:1337:0x90b2c654f18e491a566d6a38c491cf82745e5987"
 *                     manifest: "bafkreidfg3awbtjotfckd7yi33t4rxidiqusrwj6g2hb2gsczw35nlt5ab"
 *                     title: "Another Research Object"
 *               empty:
 *                 summary: No research objects found for owner
 *                 value: []
 *       400:
 *         description: Invalid request - missing owner ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *             example:
 *               error: "invalid request"
 *               details: "missing owner id in path parameter"
 *               params: {}
 *               path: "api/v2/queries/owner"
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ResearchObjectQueryError'
 *             example:
 *               error: "failed to fetch research objects"
 *               details: "flight client error"
 *               params: { id: "0x90b2c654f18e491a566d6a38c491cf82745e5987" }
 *               path: "api/v2/queries/owner"
 */
router.get("/owner/:id?", ownerQueryHandler);

export default router;
