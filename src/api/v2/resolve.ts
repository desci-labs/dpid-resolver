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
 *     summary: Resolve DPID to full research object history and metadata
 *     description: |
 *       **Primary endpoint for DPID detail pages**. Resolves a DPID to its complete research object
 *       information including version history, metadata, and manifest details.
 *
 *       ## Key Features
 *       - **Complete History**: Returns all versions with timestamps and manifests
 *       - **Version Selection**: Optionally specify a version (v1, v2, etc. or 0-based index)
 *       - **Stream Integration**: Works with both Ceramic streams and legacy DPIDs
 *       - **Metadata Rich**: Includes owner, timestamps, and version progression
 *
 *       ## Common Usage Patterns
 *
 *       **Detail Page (Latest Version)**:
 *       ```
 *       GET /v2/resolve/dpid/123
 *       ```
 *
 *       **Detail Page (Specific Version)**:
 *       ```
 *       GET /v2/resolve/dpid/123/v2
 *       GET /v2/resolve/dpid/123/1    // 0-based index
 *       ```
 *
 *       **Version Comparison UI**:
 *       ```
 *       GET /v2/resolve/dpid/123      // Get all versions
 *       GET /v2/resolve/dpid/123/v1   // Get specific version for comparison
 *       ```
 *     parameters:
 *       - in: path
 *         name: dpid
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[0-9]+$'
 *         description: The DPID number to resolve
 *         example: "123"
 *       - in: path
 *         name: versionIx
 *         required: false
 *         allowEmptyValue: true
 *         schema:
 *           type: string
 *           pattern: '^(v?[0-9]+)$'
 *         description: |
 *           Optional version specifier. Supports:
 *           - v-prefixed (v1, v2, v3) - 1-based human-readable
 *           - numeric (0, 1, 2) - 0-based index
 *           - omit for latest version
 *         examples:
 *           v1:
 *             value: "v1"
 *             summary: "First version (human-readable)"
 *           index:
 *             value: "0"
 *             summary: "First version (0-based index)"
 *           latest:
 *             value: ""
 *             summary: "Latest version (omit parameter)"
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
router.get("/dpid/:dpid/:versionIx?", resolveDpidHandler);

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
router.get("/codex/:streamOrCommitId/:versionIx?", resolveCodexHandler);

/**
 * @swagger
 * /v2/resolve/{path}:
 *   get:
 *     tags:
 *       - Resolve
 *     summary: Universal DPID resolver with flexible path and format support
 *     description: |
 *       **Universal resolver for all DPID access patterns**. This endpoint handles the most
 *       flexible resolution patterns and is ideal for:
 *       - **Direct DPID links**: Handle user-facing URLs like dpid.org/123
 *       - **File access**: Access specific files within research objects
 *       - **Format conversion**: Get content in different formats (raw, MyST, JSON-LD)
 *       - **Version browsing**: Access any version of any DPID with intuitive URLs
 *
 *       ## Path Format
 *       ```
 *       /{dpid}[/version][/path/to/file][?format=raw|myst|jsonld]
 *       ```
 *
 *       ## Common Usage Patterns
 *
 *       **Simple DPID resolution (detail page)**:
 *       ```
 *       GET /v2/resolve/123                     # Latest version, raw IPFS redirect (default)
 *       GET /v2/resolve/123/v2                  # Specific version, raw IPFS redirect
 *       GET /v2/resolve/123?format=json         # JSON API response with metadata
 *       ```
 *
 *       **Note**: All patterns work with shorthand URLs (e.g., `/123/root` → `/v2/resolve/123/root`)
 *
 *       **File browsing within research objects**:
 *       ```
 *       GET /v2/resolve/123/root                # Browse root directory (file listing)
 *       GET /v2/resolve/123/root/manuscript.pdf # Access file via root path
 *       GET /v2/resolve/123/v1/root             # Browse root of specific version
 *       GET /v2/resolve/123/data/results.csv    # Access file in subdirectory
 *       GET /v2/resolve/123/v1/data/results.csv # Access file in specific version
 *       ```
 *
 *       **Direct file downloads (IPFS redirects - default behavior)**:
 *       ```
 *       GET /v2/resolve/123                               # Redirect to latest manifest (default)
 *       GET /v2/resolve/123/root                          # Browse files via IPFS gateway (default)
 *       GET /v2/resolve/123/root/paper.pdf                # Direct download via IPFS (default)
 *       GET /v2/resolve/123/v2/root/data.csv              # Version-specific file download (default)
 *       ```
 *
 *       **Format conversion for different UIs**:
 *       ```
 *       GET /v2/resolve/123?format=json         # JSON API response with metadata
 *       GET /v2/resolve/123?format=jsonld       # Structured metadata (Semantic Web)
 *       GET /v2/resolve/123?format=myst         # MyST Markdown format
 *       GET /v2/resolve/123?format=raw          # Explicit IPFS redirect (same as default)
 *       ```
 *
 *       **Version comparison workflows**:
 *       ```
 *       GET /v2/resolve/123/v1/data/            # List files in version 1
 *       GET /v2/resolve/123/v2/data/            # List files in version 2
 *       GET /v2/resolve/123/v1/data/results.csv # Compare specific files
 *       GET /v2/resolve/123/v2/data/results.csv
 *       ```
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: |
 *           Flexible path supporting multiple formats:
 *           - `{dpid}` - DPID number (e.g., 123)
 *           - `{dpid}/v{n}` - Specific version (e.g., 123/v2)
 *           - `{dpid}/{index}` - Zero-based version (e.g., 123/1)
 *           - `{dpid}/root` - Browse root directory (file listing)
 *           - `{dpid}/root/{filename}` - Access file via root path
 *           - `{dpid}/v{n}/root` - Browse root of specific version
 *           - `{dpid}/path/to/file` - File within research object
 *           - `{dpid}/v{n}/path/to/file` - File in specific version
 *         examples:
 *           simple:
 *             value: "123"
 *             summary: "Latest version of DPID 123"
 *           versioned:
 *             value: "123/v2"
 *             summary: "Version 2 of DPID 123"
 *           rootBrowse:
 *             value: "123/root"
 *             summary: "Browse root directory files"
 *           rootFile:
 *             value: "123/root/manuscript.pdf"
 *             summary: "Access file via root path"
 *           versionedRoot:
 *             value: "123/v1/root"
 *             summary: "Browse root directory of specific version"
 *           file:
 *             value: "123/data/results.csv"
 *             summary: "Specific file in subdirectory"
 *           versionedFile:
 *             value: "123/v1/manuscript.pdf"
 *             summary: "Specific file in specific version"
 *       - in: query
 *         name: format
 *         required: false
 *         schema:
 *           type: string
 *           enum: [raw, json, myst, jsonld]
 *           default: "raw"
 *         description: |
 *           Output format (defaults to raw to avoid CORS issues):
 *           - `raw` - Redirect to IPFS (fastest, default)
 *           - `json` - JSON API response with metadata
 *           - `myst` - MyST Markdown format (for rendering)
 *           - `jsonld` - JSON-LD structured data (for semantic web)
 *         examples:
 *           raw:
 *             value: "raw"
 *             summary: "Direct IPFS redirect (fastest)"
 *           myst:
 *             value: "myst"
 *             summary: "MyST Markdown format"
 *           jsonld:
 *             value: "jsonld"
 *             summary: "Structured semantic data"
 *       - in: query
 *         name: jsonld
 *         required: false
 *         schema:
 *           type: boolean
 *         description: "⚠️ Deprecated: Use format=jsonld instead"
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
 *             examples:
 *               directoryListing:
 *                 summary: Directory listing (e.g., /123/root)
 *                 value:
 *                   Data: "CAE"
 *                   Links:
 *                     - Hash: "bafybeidyjujorntbtjvtxjqylwuwn65xxo6xkifjigg7yby42fcgitjyvq"
 *                       Name: "manuscript.pdf"
 *                       Tsize: 2949059
 *                     - Hash: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *                       Name: "data.csv"
 *                       Tsize: 1024
 *               researchObject:
 *                 summary: Full research object with history
 *                 value:
 *                   id: "kjzl6kcym7w8y9pw8d6y8lbfkqr673iecf3qsc6d4aaubzhfa11rcn3pp2nr7q8"
 *                   owner: "did:pkh:eip155:1:0x1234567890abcdef1234567890abcdef12345678"
 *                   manifest: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *                   versions:
 *                     - version: "v1"
 *                       manifest: "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *                       time: 1678901234
 *           application/ld+json:
 *             schema:
 *               type: object
 *               description: RO-Crate JSON-LD format
 *           text/myst:
 *             schema:
 *               type: string
 *               description: MyST format
 *       302:
 *         description: Redirect to IPFS gateway (when format=raw)
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               example: "https://ipfs.desci.com/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
 *             description: IPFS gateway URL for direct file access
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
router.get("/*", resolveGenericHandler);

export default router;
