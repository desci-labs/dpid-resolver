import { Router } from "express";
import { resolveDpidHandler } from "./resolvers/dpid.js";
import { resolveCodexHandler } from "./resolvers/codex.js";
import { resolveGenericHandler } from "./resolvers/generic.js";

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     HistoryQueryResult:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Stream ID (empty string for legacy entries)
 *           example: "kjzl6kcym7w8y9pw8d6y8lbfkqr673iecf3qsc6d4aaubzhfa11rcn3pp2nr7q8"
 *         owner:
 *           type: string
 *           description: Owner DID
 *           example: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
 *         manifest:
 *           type: string
 *           description: Manifest CID
 *           example: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *         versions:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               version:
 *                 type: string
 *                 description: Version commit ID (empty string for legacy entries)
 *                 example: "k6zn3ty0zptz50xjcqpiayrpowe4gr8f29zkp4up1bj7xg9wk65ea6aln2n8e6kb7hbnbd787v08gqrq3gainac2lg6csr8r8v8c8flc5xszo2kfbtbfzbb"
 *               manifest:
 *                 type: string
 *                 description: Manifest CID for this version
 *                 example: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *               time:
 *                 type: integer
 *                 description: Unix timestamp of version
 *                 example: 1678901234
 *       example:
 *         id: "kjzl6kcym7w8y9pw8d6y8lbfkqr673iecf3qsc6d4aaubzhfa11rcn3pp2nr7q8"
 *         owner: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
 *         manifest: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *         versions: [
 *           {
 *             version: "k6zn3ty0zptz50xjcqpiayrpowe4gr8f29zkp4up1bj7xg9wk65ea6aln2n8e6kb7hbnbd787v08gqrq3gainac2lg6csr8r8v8c8flc5xszo2kfbtbfzbb",
 *             manifest: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
 *             time: 1678901234
 *           }
 *         ]
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *           example: "dPID not found"
 *         details:
 *           type: object
 *           description: Detailed error information
 *           example: { "code": "NOT_FOUND", "message": "The requested dPID does not exist" }
 *         params:
 *           type: object
 *           description: Request parameters
 *           example: { "dpid": "123", "versionIx": "1" }
 *         path:
 *           type: string
 *           description: API path where error occurred
 *           example: "/v2/resolve/dpid/123/1"
 *       example:
 *         error: "dPID not found"
 *         details: { "code": "NOT_FOUND", "message": "The requested dPID does not exist" }
 *         params: { "dpid": "123", "versionIx": "1" }
 *         path: "/v2/resolve/dpid/123/1"
 */

/**
 * @swagger
 * /v2/resolve/dpid/{dpid}/{versionIx}:
 *   get:
 *     tags:
 *       - Resolve
 *     summary: Resolve dpid alias to manifest
 *     description: |
 *       Resolves a dPID to its corresponding manifest. If a version index is provided,
 *       returns the specific version of the manifest. Otherwise, returns the latest version.
 *
 *       The dPID should be a valid identifier in the format specified by the dPID standard.
 *     parameters:
 *       - in: path
 *         name: dpid
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9]+$'
 *         description: The dPID to resolve (numeric identifier)
 *         example: "123"
 *       - in: path
 *         name: versionIx
 *         required: false
 *         allowEmptyValue: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9]+$'
 *         description: Optional, zero-indexed version (numeric identifier)
 *         example: "1"
 *     responses:
 *       200:
 *         description: Successfully resolved dpid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HistoryQueryResult'
 *             example:
 *               id: "kjzl6kcym7w8y9pw8d6y8lbfkqr673iecf3qsc6d4aaubzhfa11rcn3pp2nr7q8"
 *               owner: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"
 *               manifest: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *               versions: [
 *                 {
 *                   version: "k6zn3ty0zptz50xjcqpiayrpowe4gr8f29zkp4up1bj7xg9wk65ea6aln2n8e6kb7hbnbd787v08gqrq3gainac2lg6csr8r8v8c8flc5xszo2kfbtbfzbb",
 *                   manifest: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
 *                   time: 1678901234
 *                 }
 *               ]
 *       400:
 *         description: Invalid dPID format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: dPID not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.use("/dpid/:dpid/:versionIx?", resolveDpidHandler);

/**
 * @swagger
 * /v2/resolve/codex/{streamOrCommitId}/{versionIx}:
 *   get:
 *     tags:
 *       - Resolve
 *     summary: Resolve streamId to manifest
 *     parameters:
 *       - in: path
 *         name: streamOrCommitId
 *         required: true
 *         schema:
 *           type: string
 *         description: The stream or commit ID to resolve
 *       - in: path
 *         name: versionIx
 *         required: false
 *         allowEmptyValue: true
 *         schema:
 *           type: string
 *         description: Optional version index
 *     responses:
 *       200:
 *         description: Successfully resolved stream
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HistoryQueryResult'
 *       400:
 *         description: Invalid stream or commit ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Stream not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.use("/codex/:streamOrCommitId/:versionIx?", resolveCodexHandler);

/**
 * @swagger
 * /v2/resolve/{path}:
 *   get:
 *     tags:
 *       - Resolve
 *     summary: Resolve any sensible dpid path
 *     description: |
 *       Resolves a dPID path that can include version and file path components.
 *       The path format is: /{dpid}/[version]/path/to/file
 *
 *       Examples:
 *       - /46                    - Resolves the latest version of dPID 46
 *       - /46/1                  - Resolves version 1 of dPID 46
 *       - /46/path/to/file.txt   - Resolves the file at path/to/file.txt in the latest version
 *       - /46/1/path/to/file.txt - Resolves the file at path/to/file.txt in version 1
 *
 *       The version component is optional. If omitted, the latest version is used.
 *       The file path component is also optional. If omitted, the root of the research object is returned.
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Path in format /{dpid}/[version]/path/to/file
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum: [jsonld, myst, raw]
 *         description: Output format (defaults to JSON)
 *       - in: query
 *         name: jsonld
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Deprecated. Use format=jsonld instead
 *       - in: query
 *         name: raw
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Deprecated. Use format=raw instead
 *     responses:
 *       200:
 *         description: Successfully resolved path
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HistoryQueryResult'
 *           application/ld+json:
 *             schema:
 *               type: object
 *               description: RO-Crate JSON-LD format
 *           text/myst:
 *             schema:
 *               type: string
 *               description: MyST format
 *       400:
 *         description: Invalid dpid
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Path not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.use("/*", resolveGenericHandler);

export default router;
