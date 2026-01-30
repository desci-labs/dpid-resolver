/**
 * Pagination helper utilities for building consistent, self-documenting API responses.
 *
 * Handles:
 * - Standard pagination links (self, first, prev, next, last)
 * - Toggle links for optional features (history, metadata)
 * - URL parameter building with proper state preservation
 */

export type PaginationParams = {
    /** Current page number (1-indexed) */
    page: number;
    /** Items per page */
    size: number;
    /** Total number of items */
    total: number;
    /** Sort order */
    sort: "asc" | "desc";
    /** Whether history is currently included */
    includeHistory: boolean;
    /** Whether metadata is currently included */
    includeMetadata: boolean;
    /** Metadata fields to include (when metadata is enabled) */
    metadataFields: string[];
};

export type PaginationLinks = {
    self: string;
    first: string;
    prev: string | null;
    next: string | null;
    last: string;
    /** Link to same page with version history included (null if already included) */
    withHistory: string | null;
    /** Link to same page without version history (null if already excluded) */
    withoutHistory: string | null;
    /** Link to same page with manifest metadata included (null if already included) */
    withMetadata: string | null;
    /** Link to same page without manifest metadata (null if already excluded) */
    withoutMetadata: string | null;
};

export type PaginationResult = {
    page: number;
    size: number;
    total: number;
    hasNext: boolean;
    hasPrev: boolean;
    links: PaginationLinks;
};

/**
 * Build URL query string from pagination options.
 * Only includes non-default parameters to keep URLs clean.
 */
export const buildQueryString = (options: {
    page: number;
    size: number;
    sort: "asc" | "desc";
    includeHistory: boolean;
    includeMetadata: boolean;
    metadataFields: string[];
}): string => {
    const { page, size, sort, includeHistory, includeMetadata, metadataFields } = options;

    const params: string[] = [];

    // Always include page and size
    params.push(`page=${page}`);
    params.push(`size=${size}`);

    // Only include sort if ascending (descending is default)
    if (sort === "asc") {
        params.push("sort=asc");
    }

    // Only include history if true
    if (includeHistory) {
        params.push("history=true");
    }

    // Only include metadata if true, along with fields
    if (includeMetadata) {
        params.push("metadata=true");
        if (metadataFields.length > 0) {
            params.push(`fields=${metadataFields.join(",")}`);
        }
    }

    return params.join("&");
};

/**
 * Build a pagination URL with the given parameters.
 */
export const buildPaginationUrl = (
    baseUrl: string,
    options: {
        page: number;
        size: number;
        sort: "asc" | "desc";
        includeHistory: boolean;
        includeMetadata: boolean;
        metadataFields: string[];
    },
): string => {
    const queryString = buildQueryString(options);
    return `${baseUrl}?${queryString}`;
};

/**
 * Build a toggle link that changes one parameter while preserving others.
 * Returns null if the toggle would result in the current state.
 */
export const buildToggleLink = (
    baseUrl: string,
    currentParams: PaginationParams,
    toggle: "withHistory" | "withoutHistory" | "withMetadata" | "withoutMetadata",
): string | null => {
    const { page, size, sort, includeHistory, includeMetadata, metadataFields } = currentParams;

    switch (toggle) {
        case "withHistory":
            // Return null if history is already included
            if (includeHistory) return null;
            return buildPaginationUrl(baseUrl, {
                page,
                size,
                sort,
                includeHistory: true,
                includeMetadata,
                metadataFields,
            });

        case "withoutHistory":
            // Return null if history is already excluded
            if (!includeHistory) return null;
            return buildPaginationUrl(baseUrl, {
                page,
                size,
                sort,
                includeHistory: false,
                includeMetadata,
                metadataFields,
            });

        case "withMetadata":
            // Return null if metadata is already included
            if (includeMetadata) return null;
            return buildPaginationUrl(baseUrl, {
                page,
                size,
                sort,
                includeHistory,
                includeMetadata: true,
                metadataFields,
            });

        case "withoutMetadata":
            // Return null if metadata is already excluded
            if (!includeMetadata) return null;
            return buildPaginationUrl(baseUrl, {
                page,
                size,
                sort,
                includeHistory,
                includeMetadata: false,
                metadataFields,
            });

        default:
            return null;
    }
};

/**
 * Calculate pagination metadata and generate all links.
 *
 * @param baseUrl - The base URL for the endpoint (e.g., "https://example.com/api/v2/query/dpids")
 * @param params - Current pagination parameters
 * @returns Complete pagination result with all links
 */
export const buildPagination = (baseUrl: string, params: PaginationParams): PaginationResult => {
    const { page, size, total, sort, includeHistory, includeMetadata, metadataFields } = params;

    // Calculate derived values
    const lastPage = total === 0 ? 1 : Math.ceil(total / size);
    const hasNext = page < lastPage;
    const hasPrev = page > 1;

    // Common options for building URLs
    const baseOptions = { sort, includeHistory, includeMetadata, metadataFields };

    // Build all standard pagination links
    const links: PaginationLinks = {
        self: buildPaginationUrl(baseUrl, { ...baseOptions, page, size }),
        first: buildPaginationUrl(baseUrl, { ...baseOptions, page: 1, size }),
        prev: hasPrev ? buildPaginationUrl(baseUrl, { ...baseOptions, page: page - 1, size }) : null,
        next: hasNext ? buildPaginationUrl(baseUrl, { ...baseOptions, page: page + 1, size }) : null,
        last: buildPaginationUrl(baseUrl, { ...baseOptions, page: lastPage, size }),

        // Toggle links for optional features
        withHistory: buildToggleLink(baseUrl, params, "withHistory"),
        withoutHistory: buildToggleLink(baseUrl, params, "withoutHistory"),
        withMetadata: buildToggleLink(baseUrl, params, "withMetadata"),
        withoutMetadata: buildToggleLink(baseUrl, params, "withoutMetadata"),
    };

    return {
        page,
        size,
        total,
        hasNext,
        hasPrev,
        links,
    };
};

/**
 * Generate an array of item indices for a given page.
 * Useful for generating DPID numbers or other sequential IDs.
 *
 * @param params - Object containing page, size, total, and sort
 * @returns Array of indices for the current page, in the correct order
 *
 * @example
 * // For page 1, size 3, total 10, sort "asc" -> [1, 2, 3]
 * // For page 1, size 3, total 10, sort "desc" -> [10, 9, 8]
 * // For page 2, size 3, total 10, sort "asc" -> [4, 5, 6]
 * // For page 2, size 3, total 10, sort "desc" -> [7, 6, 5]
 */
export const getPageIndices = (params: {
    page: number;
    size: number;
    total: number;
    sort: "asc" | "desc";
}): number[] => {
    const { page, size, total, sort } = params;

    if (total === 0) return [];

    // Calculate start and end indices (1-based)
    let startIndex: number;
    let endIndex: number;

    if (sort === "desc") {
        // Descending: page 1 gets highest indices
        // Page 1 with size 3, total 10: indices 10, 9, 8
        // Page 2 with size 3, total 10: indices 7, 6, 5
        endIndex = total - (page - 1) * size;
        startIndex = Math.max(1, endIndex - size + 1);
    } else {
        // Ascending: page 1 gets lowest indices
        // Page 1 with size 3, total 10: indices 1, 2, 3
        // Page 2 with size 3, total 10: indices 4, 5, 6
        startIndex = (page - 1) * size + 1;
        endIndex = Math.min(total, startIndex + size - 1);
    }

    // Generate the array
    const count = endIndex - startIndex + 1;
    if (count <= 0) return [];

    return Array.from({ length: count }, (_, i) => (sort === "desc" ? endIndex - i : startIndex + i));
};
