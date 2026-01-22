import type { Request, Response } from "express";
import axios from "axios";
import { RoCrateTransformer, type ResearchObjectV1 } from "@desci-labs/desci-models";

import parentLogger, { serializeError } from "../../../logger.js";
import analytics, { LogEventType } from "../../../analytics.js";
import { IPFS_GATEWAY, getNodesUrl, getNodesApiUrl } from "../../../util/config.js";
import { buildMystPageFromManifest, type IJMetadata } from "../../../util/myst.js";
import { DpidResolverError, resolveDpid } from "./dpid.js";
import type { HistoryQueryResult } from "../queries/history.js";
import { isDpid, isVersionString } from "../../../util/validation.js";
import { getIpfsFolderTreeByCid, ipfsCat, type EnhancedIpfsEntry } from "../data/getIpfsFolder.js";
import { getManifest } from "../../../util/manifests.js";

const MODULE_PATH = "/api/v2/resolvers/generic" as const;

const logger = parentLogger.child({
    module: MODULE_PATH,
});

const IPFS_API_URL = IPFS_GATEWAY.replace(/\/ipfs\/?$/, "/api/v0");
const NODES_URL = getNodesUrl();

/**
 * Fetch AI-generated keywords from the nodes API for a given dPID.
 * Returns an empty array if the fetch fails or no keywords are found.
 */
const fetchAiKeywords = async (dpid: number): Promise<string[]> => {
    try {
        const nodesApiUrl = getNodesApiUrl();
        const response = await axios.get(
            `${nodesApiUrl}/v1/search/library/${dpid}`,
            { timeout: 5000 }
        );
        const concepts = response.data?.data?.concepts;
        if (concepts && Array.isArray(concepts)) {
            return concepts.map((c: { display_name: string }) => c.display_name);
        }
        return [];
    } catch (e) {
        logger.warn({ dpid, error: e }, "Failed to fetch AI keywords");
        return [];
    }
};

export type ResolveGenericParams = {
    // This is how express maps a wildcard :shrug:
    0: string;
};

export type ResolveGenericQueryParams = {
    /** @deprecated use format instead */
    raw?: "";
    /** @deprecated use format instead */
    jsonld?: "";
    format?: "jsonld" | "json" | "raw" | "myst";
};

export type ErrorResponse = {
    error: string;
    details: unknown;
    params: Record<string, string>;
    query: Record<string, string>;
    path: typeof MODULE_PATH;
};

export type SuccessResponse =
    | ResearchObjectV1 // raw request on plain dPID, i.e. no DAG path
    | unknown; // in case of directly returning an UnixFS data node

export type ResolveGenericResponse = SuccessResponse | ErrorResponse;

const flattenIpfsFolder = (ipfsFolder: EnhancedIpfsEntry): Array<EnhancedIpfsEntry> => {
    return ipfsFolder.children?.flatMap((child: EnhancedIpfsEntry) => [child, ...flattenIpfsFolder(child)]) ?? [];
};

/**
 * Resolve a dPID path. Will redirect to Nodes as viewer,
 * unless the `&raw` query parameter is set in the URL.
 *
 * @returns response with the target data, void in the case of a redirect
 */
export const resolveGenericHandler = async (
    req: Request<ResolveGenericParams, unknown, undefined, ResolveGenericQueryParams>,
    res: Response<ResolveGenericResponse>,
): Promise<typeof res | void> => {
    const path = req.params[0];
    const query = req.query;

    if (path.includes("favicon.ico")) {
        return res.status(404).send();
    }

    const baseError = {
        params: req.params,
        query: req.query,
        path: MODULE_PATH,
    };

    logger.info({ path, query }, `Resolving path: ${path}`);

    const [dpid, ...rest] = path.split("/");
    if (!isDpid(dpid)) {
        logger.error({ path }, "invalid dpid");
        return res.status(400).send({
            error: "invalid dpid",
            details: `expected valid dpid in path, got '${dpid}'`,
            ...baseError,
        });
    }

    // Smart format detection to avoid CORS issues while preserving human-readable redirects
    // Default to raw for API requests (to prevent CORS), but redirect browsers to Nodes
    const acceptHeader = req.headers.accept || "";
    const isApiRequest = acceptHeader.includes("application/json") && !acceptHeader.includes("text/html");

    // Content negotiation: check Accept header for JSON-LD, RDF, or Turtle formats (F-UJI uses these)
    const wantsJsonLdViaHeader =
        acceptHeader.includes("application/ld+json") ||
        acceptHeader.includes("application/json-ld");
    const wantsRdfViaHeader =
        acceptHeader.includes("text/turtle") ||
        acceptHeader.includes("application/rdf+xml") ||
        acceptHeader.includes("text/n3") ||
        acceptHeader.includes("text/rdf+n3");

    const isRaw =
        query.raw !== undefined ||
        query.format === "raw" ||
        (query.format === undefined && isApiRequest && !wantsJsonLdViaHeader && !wantsRdfViaHeader) ||
        query.format === "json";
    // Support both query parameter AND Accept header content negotiation for JSON-LD
    const isJsonld = query.jsonld !== undefined || query.format === "jsonld" || wantsJsonLdViaHeader || wantsRdfViaHeader;
    const isMyst = query.format === "myst";

    /** dPID version identifier, possibly adjusted to 0-based indexing */
    let versionIx: number | undefined;
    /** dPID path suffix, possibly empty */
    let suffix = "";
    if (rest.length > 0) {
        const maybeVersionString = rest[0];
        if (isVersionString(maybeVersionString)) {
            versionIx = getVersionIndex(maybeVersionString);
            suffix = rest.slice(1).join("/");
            logger.info({ dpid, path, versionIx, suffix }, "extracted version from path");
        } else {
            versionIx = undefined;
            suffix = rest.join("/");
            logger.info(
                { dpid, path, versionIx, suffix },
                "couldn't extract version, considering first segment part of path suffix",
            );
        }
    }

    // Build base URLs for Signposting headers
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const dpidUrl = `${baseUrl}/${dpid}`;
    const jsonldUrl = `${dpidUrl}?format=jsonld`;
    
    // Add Signposting Link headers for FAIR compliance (F4.1)
    // https://signposting.org/FAIR/
    const addSignpostingHeaders = (response: Response, manifest?: ResearchObjectV1) => {
        const linkHeaders: string[] = [];
        
        // Link to metadata in JSON-LD format (describedby)
        linkHeaders.push(`<${jsonldUrl}>; rel="describedby"; type="application/ld+json"`);
        
        // Link to the landing page (cite-as for persistent identifier)
        linkHeaders.push(`<${dpidUrl}>; rel="cite-as"`);
        
        // Link to RO-Crate profile
        linkHeaders.push(`<https://w3id.org/ro/crate/1.1>; rel="type"`);
        
        // Link to license if available
        if (manifest?.defaultLicense) {
            const licenseUrl = LICENSES_TO_URL[manifest.defaultLicense] || manifest.defaultLicense;
            if (licenseUrl.startsWith('http')) {
                linkHeaders.push(`<${licenseUrl}>; rel="license"`);
            }
        }
        
        // Link to authors/creators if available
        manifest?.authors?.forEach(author => {
            if (author.orcid) {
                const orcidUrl = author.orcid.startsWith('https://') 
                    ? author.orcid 
                    : `https://orcid.org/${author.orcid}`;
                linkHeaders.push(`<${orcidUrl}>; rel="author"`);
            }
        });
        
        response.setHeader("Link", linkHeaders.join(", "));
    };

    // License URL mapping (duplicated from RoCrateTransformer for header generation)
    const LICENSES_TO_URL: { [k: string]: string } = {
        'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
        'CC-BY-SA-4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
        'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
        'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
        'MIT': 'https://opensource.org/licenses/MIT',
        'GPL-3.0': 'https://www.gnu.org/licenses/gpl-3.0.en.html',
        'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
    };

    if (isJsonld) {
        logger.info({ path, query }, "got request for jsonld");
        // Get full history to access timestamp for datePublished
        const resolveResult = await resolveDpid(parseInt(dpid), versionIx);
        const cid = resolveResult.manifest;
        const transformer = new RoCrateTransformer();

        const manifest = await getManifest(cid);
        if (!manifest) {
            return res.status(500).send({ error: "Could not get manifest", cid });
        }

        // Get the publication timestamp from the version history
        // Use the requested version's timestamp, or the first version if not specified
        let datePublished: number | undefined;
        if (resolveResult.versions && resolveResult.versions.length > 0) {
            // If a specific version was requested, use that version's time
            // Otherwise use the first (oldest) version's time as the publication date
            const targetVersionIdx = versionIx ?? 0;
            const targetVersion = resolveResult.versions[targetVersionIdx] ?? resolveResult.versions[0];
            datePublished = targetVersion?.time;
        }

        // Fetch file sizes from IPFS for FAIR R1-01M-2 compliance
        // This provides contentSize metadata for each data file
        let fileSizes: Record<string, number> = {};
        try {
            const rootComponent = manifest.components.find(c => c.name === 'root');
            if (rootComponent?.payload?.cid) {
                const ipfsTree = await getIpfsFolderTreeByCid(rootComponent.payload.cid, {
                    rootName: 'root',
                    concurrency: 4,
                    depth: 'full',
                });
                // Build a map of CID -> size from the IPFS tree
                const collectSizes = (entry: typeof ipfsTree) => {
                    if (entry.size) {
                        fileSizes[entry.cid] = entry.size;
                        fileSizes[entry.name] = entry.size;
                    }
                    entry.children?.forEach(collectSizes);
                };
                collectSizes(ipfsTree);
                logger.info({ dpid, fileCount: Object.keys(fileSizes).length }, "Collected file sizes from IPFS");
            }
        } catch (e) {
            logger.warn({ dpid, error: e }, "Failed to fetch file sizes from IPFS, continuing without them");
        }

        // Fetch AI keywords if manifest has no keywords
        let aiKeywords: string[] = [];
        if (!manifest.keywords || manifest.keywords.length === 0) {
            aiKeywords = await fetchAiKeywords(parseInt(dpid));
            if (aiKeywords.length > 0) {
                logger.info({ dpid, keywordCount: aiKeywords.length }, "Using AI-generated keywords");
            }
        }

        // Export with FAIR-compliant metadata
        const roCrate = transformer.exportObject(manifest, {
            dpid: parseInt(dpid),
            datePublished,
            publisher: 'DeSci Labs',
            dpidBaseUrl: baseUrl,
            fileSizes,
            aiKeywords,
        });
        
        // Add Signposting headers
        addSignpostingHeaders(res, manifest);
        
        return res.setHeader("Content-Type", "application/ld+json").send(JSON.stringify(roCrate));
    }

    if (isMyst) {
        logger.info({ path, query }, "got request for myst");
        const resolveResult = await resolveDpid(parseInt(dpid), versionIx);

        const cid = resolveResult.manifest;
        const manifest = await getManifest(cid);
        if (!manifest) {
            return res.status(500).send({ error: "Could not get manifest", cid });
        }

        const dataBucket = manifest.components[0].payload;
        if (!dataBucket) {
            return res.status(500).send({ error: "Could not find data bucket in manifest", cid });
        }

        const ipfsFolder = await getIpfsFolderTreeByCid(dataBucket.cid, {
            rootName: "root",
            concurrency: 8,
            depth: "full",
        });

        let ijMetadata: IJMetadata | undefined;
        try {
            const tempMetadata = (await ipfsCat(`${dataBucket.cid}/insight-journal-metadata.json`)) as unknown as {
                license: string;
                publication_id: number;
                revisions: Array<{
                    citation_list: Array<{ type?: string; id?: string; title?: string }>;
                    doi?: string;
                }>;
                date_submitted: string;
                submitted_by_author: {
                    author_email: string;
                    author_institution: string;
                };
                tags?: string[];
                source_code_git_repo?: string;
            };
            logger.info({ ipfsFolder }, "Temp metadata");

            const cover = (manifest.coverImage as string | undefined) ?? undefined;
            ijMetadata = {
                license_text: tempMetadata.license,
                id: tempMetadata.publication_id,
                citation_list: tempMetadata.revisions[0]?.citation_list,
                date_submitted: tempMetadata.date_submitted,
                corresponding_author: tempMetadata.submitted_by_author?.author_email,
                affiliations: {
                    [tempMetadata.submitted_by_author?.author_email]:
                        tempMetadata.submitted_by_author?.author_institution,
                },
                thumbnail: cover ? `https://pub.desci.com/ipfs/${cover}` : undefined,
                flatFiles: flattenIpfsFolder(ipfsFolder).filter((f) => f.type === "file"),
                doi: tempMetadata.revisions?.[0]?.doi,
                tags: tempMetadata.tags,
                source_code_git_repo: tempMetadata.source_code_git_repo,
            };
        } catch (e) {
            logger.error(e, "Error fetching ij metadata");
        }

        const page = await buildMystPageFromManifest({
            manifest,
            dpid: parseInt(dpid),
            history: resolveResult,
            version: versionIx,
            ijMetadata,
        });

        return res.setHeader("Content-Type", "application/json").send(JSON.stringify(page));
    }

    analytics.log({
        dpid: parseInt(dpid),
        version: versionIx || -1,
        eventType: LogEventType.DPID_GET,
        extra: {
            dpid,
            version: versionIx,
            raw: isRaw,
            jsonld: isJsonld,
            myst: isMyst,
            domain: req.hostname,
            params: req.params,
            query: req.query,
            suffix,
        },
    });

    // Check if this is a request from a crawler or FAIR assessment tool
    // These tools need a 200 response with Signposting headers (not a redirect)
    // so they can discover and follow the rel="describedby" link to get metadata
    const userAgent = req.headers["user-agent"] || "";
    const isCrawlerOrAssessment = 
        userAgent.includes("F-UJI") || 
        userAgent.includes("Googlebot") || 
        userAgent.includes("bingbot") ||
        userAgent.includes("Slurp") ||
        userAgent.includes("DuckDuckBot") ||
        userAgent.includes("facebookexternalhit") ||
        userAgent.includes("LinkedInBot") ||
        userAgent.includes("Twitterbot") ||
        userAgent.includes("Semanticbot");

    // For crawlers/assessment tools: Return a landing page with:
    // 1. Signposting HTTP Link headers (for tools that follow links)
    // 2. Embedded JSON-LD in HTML (for search engine compatibility - F4.1)
    // Best practice per https://signposting.org/FAIR/
    if (!isRaw && !suffix && isCrawlerOrAssessment) {
        logger.info({ dpid, userAgent }, "serving FAIR landing page for crawler/assessment tool");
        
        try {
            const resolveResult = await resolveDpid(parseInt(dpid), versionIx);
            const manifest = await getManifest(resolveResult.manifest);
            
            if (manifest) {
                const transformer = new RoCrateTransformer();
                
                // Get the publication timestamp
                let datePublished: number | undefined;
                if (resolveResult.versions && resolveResult.versions.length > 0) {
                    const targetVersionIdx = versionIx ?? 0;
                    const targetVersion = resolveResult.versions[targetVersionIdx] ?? resolveResult.versions[0];
                    datePublished = targetVersion?.time;
                }
                
                // Fetch file sizes from IPFS for FAIR R1-01M-2 compliance
                let fileSizes: Record<string, number> = {};
                try {
                    const rootComponent = manifest.components.find(c => c.name === 'root');
                    if (rootComponent?.payload?.cid) {
                        const ipfsTree = await getIpfsFolderTreeByCid(rootComponent.payload.cid, {
                            rootName: 'root',
                            concurrency: 4,
                            depth: 'full',
                        });
                        const collectSizes = (entry: typeof ipfsTree) => {
                            if (entry.size) {
                                fileSizes[entry.cid] = entry.size;
                                fileSizes[entry.name] = entry.size;
                            }
                            entry.children?.forEach(collectSizes);
                        };
                        collectSizes(ipfsTree);
                    }
                } catch (e) {
                    logger.warn({ dpid, error: e }, "Failed to fetch file sizes for landing page");
                }

                // Fetch AI keywords if manifest has no keywords
                let aiKeywords: string[] = [];
                if (!manifest.keywords || manifest.keywords.length === 0) {
                    aiKeywords = await fetchAiKeywords(parseInt(dpid));
                    if (aiKeywords.length > 0) {
                        logger.info({ dpid, keywordCount: aiKeywords.length }, "Using AI-generated keywords for landing page");
                    }
                }
                
                const roCrate = transformer.exportObject(manifest, {
                    dpid: parseInt(dpid),
                    datePublished,
                    publisher: 'DeSci Labs',
                    dpidBaseUrl: baseUrl,
                    fileSizes,
                    aiKeywords,
                });
                
                // Add Signposting HTTP headers
                addSignpostingHeaders(res, manifest);
                
                const nodesUrl = `${NODES_URL}/dpid/${dpid}`;
                const licenseUrl = LICENSES_TO_URL[manifest.defaultLicense || ''] || manifest.defaultLicense || '';
                const identifier = `dpid://${dpid}`;
                
                // HTML with embedded JSON-LD for F4.1 (search engine compatibility)
                // and Signposting <link> elements for tools that parse HTML
                // Note: NO meta refresh for crawlers/assessment tools - they need to read the embedded JSON-LD
                // Note: Must have >150 chars of visible text to avoid "JavaScript generated" detection
                const authorNames = manifest.authors?.map(a => a.name).join(', ') || '';
                const fullDescription = manifest.description || 'Research Object published on DeSci Labs. This is a decentralized persistent identifier (dPID) managed by DeSci Labs for open science publishing.';
                const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${manifest.title || `dPID ${dpid}`}</title>
    <meta name="description" content="${fullDescription.replace(/"/g, '&quot;').substring(0, 300)}">
    <meta name="keywords" content="research, dataset, open science, FAIR, dpid, persistent identifier">
    <meta name="author" content="${authorNames}">
    <meta name="publisher" content="DeSci Labs">
    <link rel="canonical" href="${dpidUrl}">
    <link rel="describedby" type="application/ld+json" href="${jsonldUrl}">
    <link rel="cite-as" href="${dpidUrl}">
    ${licenseUrl.startsWith('http') ? `<link rel="license" href="${licenseUrl}">` : ''}
    <script type="application/ld+json">${JSON.stringify(roCrate)}</script>
</head>
<body>
    <article itemscope itemtype="https://schema.org/Dataset">
        <header>
            <h1 itemprop="name">${manifest.title || `dPID ${dpid}`}</h1>
            <p itemprop="identifier">Persistent Identifier: <a href="${dpidUrl}" itemprop="url">${identifier || dpidUrl}</a></p>
        </header>
        <section>
            <h2>Description</h2>
            <p itemprop="description">${fullDescription}</p>
        </section>
        <section>
            <h2>Metadata</h2>
            <dl>
                <dt>Publisher</dt>
                <dd itemprop="publisher" itemscope itemtype="https://schema.org/Organization">
                    <span itemprop="name">DeSci Labs</span>
                </dd>
                ${authorNames ? `<dt>Authors</dt><dd itemprop="creator">${authorNames}</dd>` : ''}
                <dt>License</dt>
                <dd><a href="${licenseUrl}" itemprop="license">${manifest.defaultLicense || 'See license'}</a></dd>
                <dt>Type</dt>
                <dd>Dataset / Research Object</dd>
                <dt>Access</dt>
                <dd itemprop="isAccessibleForFree">Open Access (Free)</dd>
            </dl>
        </section>
        <footer>
            <p>This Research Object is published on the <a href="https://desci.com">DeSci Labs</a> platform using decentralized persistent identifiers (dPIDs).</p>
            <p><a href="${nodesUrl}">View full Research Object on DeSci Nodes</a></p>
        </footer>
    </article>
</body>
</html>`;
                
                return res.setHeader("Content-Type", "text/html; charset=utf-8").send(html);
            }
        } catch (e) {
            logger.warn({ dpid, error: e }, "Failed to generate FAIR landing page, falling back to redirect");
            // Fall through to normal redirect
        }
    }

    // Redirect non-raw resolution requests to the Nodes gateway
    if (!isRaw) {
        let target = `${NODES_URL}/dpid/${dpid}`;

        if (versionIx !== undefined) {
            // Nodes always wants v-prefixed one-based indexing
            target += `/v${versionIx + 1}`;
        }

        if (suffix) {
            // Let Nodes figure out what to do if path doesn't make sense
            target += `/${suffix}`;
        }

        logger.info({ dpid, target, path, query }, "redirecting root dPID reference to Nodes");
        return res.redirect(target);
    }

    // If we didn't redirect to the Nodes app, we're either dealing with a raw
    // request or a file path, in either case we need to fetch the manifest
    let resolveResult: HistoryQueryResult;
    try {
        resolveResult = await resolveDpid(parseInt(dpid), versionIx);
        logger.info({ dpid, path, query }, "resolved dpid manifest");
    } catch (e) {
        if (e instanceof DpidResolverError) {
            const errPayload = {
                error: e.message,
                details: serializeError(e.cause),
                ...baseError,
            };
            logger.error(errPayload, "failed to resolve dpid");
            return res.status(500).send(errPayload);
        } else {
            const err = e as Error;
            const errPayload = {
                error: err.message,
                details: serializeError(err),
                ...baseError,
            };
            logger.error(errPayload, "unexpected error occurred");
            return res.status(503).send(errPayload);
        }
    }

    /** dPID path doesn't refer to a file in the data tree */
    const noDagPath = suffix.length === 0;
    const cid = resolveResult.manifest;
    const manifestUrl = `${IPFS_GATEWAY}/${cid}`;

    if (noDagPath) {
        // Return manifest url as is
        logger.info({ dpid, manifestUrl, path, query, suffix }, "redirecting raw request to IPFS resolver");
        return res.redirect(manifestUrl);
    } else if (suffix.startsWith("root") || suffix.startsWith("data")) {
        // The suffix is pointing to a target in drive, let's find the UnixFS root
        logger.info({ dpid, path, query, suffix }, "assuming suffix is a drive path");

        const manifest = await getManifest(cid);
        if (!manifest) {
            return res.status(500).send({ error: "Could not get manifest", cid });
        }

        const maybeDataBucket = manifest.components.find((c) => c.name === "root");
        // || manifest.components[0] shouldn't be necessary?

        if (!maybeDataBucket) {
            const errPayload = {
                error: "Invalid dPID path",
                details: "Manifest doesn't have a data bucket, this is unexpected",
                ...baseError,
            };
            logger.error(errPayload, "missing data bucket");
            return res.status(410).send(errPayload);
        }

        const dagPath = `${maybeDataBucket.payload.cid}/${suffixToDagPath(suffix)}`;
        // Convert gateway to API URl
        const maybeValidDagUrl = `${IPFS_API_URL}/dag/get?arg=${dagPath}`;

        try {
            // Let's be optimistic
            const { data } = await axios({ method: "POST", url: maybeValidDagUrl });
            logger.info({ ipfsData: data }, "IPFS DATA");

            // Check for magical UnixFS clues
            if (magicIsUnixDir(data)) {
                // It's a dir, respond with the raw IPLD node as JSON
                return res.status(200).send(data);
            } else {
                // It's a file or some random shit, redirect to resolver to
                // dodge relaying a large transfer
                return res.redirect(`${IPFS_GATEWAY}/${dagPath}`);
            }
        } catch (e) {
            // Doesn't seem it was a validDagUrl
            const errPayload = {
                error: "Failed to resolve DAG URL; check path and versioning",
                details: serializeError(e as Error),
                ...baseError,
            };
            logger.error(errPayload, "got invalid DAG URL");
            return res.status(404).send(errPayload);
        }
    } else {
        // Other cases are illegal, unclear what's going on
        const errPayload = {
            error: "Invalid dPID path",
            details: "Path suffix must reference to address drive content /root",
            suffix,
            ...baseError,
        };
        logger.error(errPayload, "invalid path suffix");
        return res.status(400).send(errPayload);
    }
};

const getVersionIndex = (versionString: string): number => {
    let index;
    if (versionString.startsWith("v")) {
        // Compensate for one-based indexing
        index = parseInt(versionString.slice(1)) - 1;
    } else {
        index = parseInt(versionString);
    }

    logger.info({ versionString, index }, "parsed version string");
    return index;
};

/**
 * Fun with IPLD/UnixFS part 4512:
 * - UnixFS data follows this protobuf schema: https://github.com/ipfs/specs/blob/main/UNIXFS.md#data-format
 * - Length-delimited protobuf encoding writes each fields as [size,data]
 * - The `Type` field is an enum, which is 8 bits long by default
 * - `Directory` has the enum value `1`
 * - [0x8,0x1] in base64 => CAE
 *
 * Hence, "CAE" obviously says "I'm a directory!"
 */
const MAGIC_UNIXFS_DIR_FLAG = "CAE";

/* eslint-disable @typescript-eslint/no-explicit-any */
const magicIsUnixDir = (mysteriousData: any) => mysteriousData.Data?.["/"]?.bytes === MAGIC_UNIXFS_DIR_FLAG;

const rBucketRefHead = /^(root|data)\/?/;

/**
 * Cleanup leading data bucket references, and remove any trailing query params
 */
const suffixToDagPath = (suffix: string) => suffix.replace(rBucketRefHead, "");
