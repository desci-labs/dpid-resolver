import type { ResearchObjectV1, ResearchObjectV1Author } from "@desci-labs/desci-models";
import type { HistoryQueryResult } from "../api/v2/queries/history.js";
import type { EnhancedIpfsEntry } from "../api/v2/data/getIpfsFolder.js";

export type IJMetadata = {
    affiliations?: Record<string, string>;
    corresponding_author?: string;
    flatFiles?: Array<EnhancedIpfsEntry> | undefined;
    license_text?: string;
    id?: number;
    journal_name?: string;
    journalName?: string;
    date_submitted?: string;
    submitted?: string;
    thumbnail?: string | undefined;
    thumbnail_optimized?: string;
    thumbnailOptimized?: string;
    source_code_git_url?: string;
    code_url?: string;
    doi?: string;
    reviews?: Array<{
        reviewer_name?: string;
        name?: string;
        reviewer_email?: string;
        email?: string;
        date?: string;
        review_date?: string;
        content?: string;
        review?: string;
    }>;
    revision_dois?: string[];
    revisions?: Array<{ doi?: string }>;
    revision_cids?: string[];
    citation_list?: Array<{
        type?: string;
        id?: string;
        title?: string;
    }>;
};

/**
 * Build a minimal MyST Page JSON structure compatible with @awesome-myst/myst-zod Page.
 * Some fields may be empty when not available in legacy manifests.
 */
export async function buildMystPageFromManifest(params: {
    manifest: ResearchObjectV1;
    dpid: number;
    history?: HistoryQueryResult;
    ijMetadata?: IJMetadata | null;
    version?: number;
}): Promise<Record<string, unknown>> {
    const { manifest, dpid, history, ijMetadata, version } = params;

    const title = manifest.title ?? undefined;
    const abstract = manifest.description ?? undefined;
    const license = manifest.defaultLicense ?? undefined;
    const keywords = manifest.keywords ?? undefined;
    const tags = manifest.tags?.map((t) => t.name) ?? undefined;

    // Map authors
    const authors:
        | Array<{ name: string; email?: string; roles?: string[]; orcid?: string; institutions?: string[] }>
        | undefined = manifest.authors?.map((a: ResearchObjectV1Author & { email?: string }) => {
        // const role = Array.isArray(a.role) ? a.role : [a.role];
        return {
            name: a.name,
            email: a.email ?? undefined,
            // roles: role?.filter(Boolean) ?? undefined,
            orcid: a.orcid ?? undefined,
            affiliations: [ijMetadata?.affiliations?.[a.email ?? ""] ?? undefined].filter(Boolean),
            corresponding: (ijMetadata?.corresponding_author ?? undefined) == a.email || undefined,
        };
    });

    // References from manifest (minimal)
    // const referencesFromManifest: Array<{ type?: string; id?: string; title?: string }> =
    //     (manifest.references as ResearchObjectReference[] | undefined)?.map((r) => ({
    //         type: r.type,
    //         id: r.id,
    //         title: r.title,
    //     })) ?? [];

    // Pull optional IJ metadata, if available (typed access helpers)
    const ij = (ijMetadata ?? {}) as IJMetadata;

    const ijPubId = typeof ij.id === "number" ? ij.id : undefined;
    const journalName = ij.journal_name ?? ij.journalName ?? undefined;
    const dateSubmitted: string | undefined = ij.date_submitted ?? ij.submitted ?? undefined;
    const thumbnail: string | undefined = ij.thumbnail ?? undefined;
    const thumbnailOptimized: string | undefined = ij.thumbnail_optimized ?? ij.thumbnailOptimized ?? undefined;
    const sourceCodeGitUrl: string | undefined = ij.source_code_git_url ?? ij.code_url ?? undefined;

    const reviewers: Array<{ name?: string; email?: string; date?: string; content?: string }> | undefined =
        Array.isArray(ij.reviews)
            ? ij.reviews.map((r) => ({
                  name: r?.reviewer_name ?? r?.name ?? undefined,
                  email: r?.reviewer_email ?? r?.email ?? undefined,
                  date: r?.date ?? r?.review_date ?? undefined,
                  content: r?.content ?? r?.review ?? undefined,
              }))
            : undefined;

    const revisionDois: string[] | undefined = Array.isArray(ij.revision_dois)
        ? ij.revision_dois
        : Array.isArray(ij.revisions)
          ? ij.revisions.map((r) => r?.doi).filter((v): v is string => Boolean(v))
          : undefined;

    const revisionCids: string[] | undefined = Array.isArray(ij.revision_cids)
        ? ij.revision_cids
        : Array.isArray(history?.versions)
          ? history!.versions.map((v) => v.manifest).filter((v): v is string => Boolean(v))
          : undefined;

    // Earliest known version time as submission date fallback
    const earliestVersionTime = history?.versions?.length
        ? new Date(Math.min(...history.versions.map((v) => (v.time ?? 0) * 1000))).toISOString()
        : undefined;

    console.log({ version });

    // let DPID_URL = "";
    // switch (process.env.DPID_ENV) {
    //     case "local":
    //         DPID_URL = "http://localhost:3000";
    //         break;
    //     case "dev":
    //         DPID_URL = "https://dev-beta.dpid.org";
    //         break;

    //     case "production":
    //         DPID_URL = "https://dpid.org";
    //         break;
    //     default:
    //         DPID_URL = "https://dpid.org";
    //         break;
    // }

    // MyST Page fields
    const page = {
        version: version !== undefined && !isNaN(version) && version > -1 ? version + 1 : revisionCids?.length ?? 0,
        kind: "Article",
        sha256: "",
        slug: String(ijPubId ?? dpid),
        location: "",
        dependencies: [] as unknown[],
        doi: ij.doi ?? undefined,
        thumbnail: ijMetadata?.thumbnail ?? undefined,
        frontmatter: {
            // Typical MyST/Sphinx-like fields
            title,
            abstract,
            license: ijMetadata?.license_text ?? license,
            keywords,
            tags,
            authors,

            // Extra IJ-specific fields when available
            date_submitted: dateSubmitted ?? earliestVersionTime,
            external_publication_id: ijPubId ?? dpid,
            revision_dois: revisionDois,
            revision_cids: revisionCids,
            source_code_git_url: sourceCodeGitUrl,
            reviewers,
            journal_name: journalName,
            thumbnail,
            thumbnail_optimized: thumbnailOptimized,
        },
        mdast: { type: "root" },
        downloads: ij.flatFiles?.map((f: EnhancedIpfsEntry) => ({
            url:
                !f.gateway || f.gateway === "public"
                    ? `https://ipfs.io/ipfs/${f.cid}`
                    : `https://ipfs.desci.com/ipfs/${f.cid}`,
            title: f.path,
            filename: f.name,
            extra: {
                size_bytes: f.size,
                type: f.type,
            },
        })),
    };

    return page;
}
