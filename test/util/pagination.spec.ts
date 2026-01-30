import { describe, expect, it } from "vitest";
import {
    buildQueryString,
    buildPaginationUrl,
    buildToggleLink,
    buildPagination,
    getPageIndices,
    type PaginationParams,
} from "../../src/util/pagination.js";

describe("pagination utilities", () => {
    const baseUrl = "https://example.com/api/v2/query/dpids";

    describe("buildQueryString", () => {
        it("should include page and size always", () => {
            const result = buildQueryString({
                page: 1,
                size: 20,
                sort: "desc",
                includeHistory: false,
                includeMetadata: false,
                metadataFields: [],
            });
            expect(result).toBe("page=1&size=20");
        });

        it("should include sort=asc when sort is ascending", () => {
            const result = buildQueryString({
                page: 1,
                size: 20,
                sort: "asc",
                includeHistory: false,
                includeMetadata: false,
                metadataFields: [],
            });
            expect(result).toBe("page=1&size=20&sort=asc");
        });

        it("should not include sort parameter when descending (default)", () => {
            const result = buildQueryString({
                page: 2,
                size: 10,
                sort: "desc",
                includeHistory: false,
                includeMetadata: false,
                metadataFields: [],
            });
            expect(result).not.toContain("sort");
        });

        it("should include history=true when includeHistory is true", () => {
            const result = buildQueryString({
                page: 1,
                size: 20,
                sort: "desc",
                includeHistory: true,
                includeMetadata: false,
                metadataFields: [],
            });
            expect(result).toBe("page=1&size=20&history=true");
        });

        it("should include metadata=true and fields when includeMetadata is true", () => {
            const result = buildQueryString({
                page: 1,
                size: 20,
                sort: "desc",
                includeHistory: false,
                includeMetadata: true,
                metadataFields: ["title", "authors"],
            });
            expect(result).toBe("page=1&size=20&metadata=true&fields=title,authors");
        });

        it("should include all parameters when all options are enabled", () => {
            const result = buildQueryString({
                page: 3,
                size: 50,
                sort: "asc",
                includeHistory: true,
                includeMetadata: true,
                metadataFields: ["title", "description", "keywords"],
            });
            expect(result).toBe(
                "page=3&size=50&sort=asc&history=true&metadata=true&fields=title,description,keywords",
            );
        });

        it("should handle empty metadataFields when metadata is enabled", () => {
            const result = buildQueryString({
                page: 1,
                size: 20,
                sort: "desc",
                includeHistory: false,
                includeMetadata: true,
                metadataFields: [],
            });
            expect(result).toBe("page=1&size=20&metadata=true");
        });
    });

    describe("buildPaginationUrl", () => {
        it("should combine baseUrl and query string", () => {
            const result = buildPaginationUrl(baseUrl, {
                page: 1,
                size: 20,
                sort: "desc",
                includeHistory: false,
                includeMetadata: false,
                metadataFields: [],
            });
            expect(result).toBe("https://example.com/api/v2/query/dpids?page=1&size=20");
        });

        it("should handle complex query parameters", () => {
            const result = buildPaginationUrl(baseUrl, {
                page: 5,
                size: 10,
                sort: "asc",
                includeHistory: true,
                includeMetadata: true,
                metadataFields: ["title"],
            });
            expect(result).toBe(
                "https://example.com/api/v2/query/dpids?page=5&size=10&sort=asc&history=true&metadata=true&fields=title",
            );
        });
    });

    describe("buildToggleLink", () => {
        const baseParams: PaginationParams = {
            page: 2,
            size: 20,
            total: 100,
            sort: "desc",
            includeHistory: false,
            includeMetadata: false,
            metadataFields: ["title", "authors"],
        };

        describe("withHistory toggle", () => {
            it("should return URL with history=true when history is currently false", () => {
                const result = buildToggleLink(baseUrl, baseParams, "withHistory");
                expect(result).not.toBeNull();
                expect(result).toContain("history=true");
            });

            it("should return null when history is already true", () => {
                const result = buildToggleLink(baseUrl, { ...baseParams, includeHistory: true }, "withHistory");
                expect(result).toBeNull();
            });

            it("should preserve metadata state when toggling history on", () => {
                const result = buildToggleLink(baseUrl, { ...baseParams, includeMetadata: true }, "withHistory");
                expect(result).toContain("history=true");
                expect(result).toContain("metadata=true");
                expect(result).toContain("fields=title,authors");
            });
        });

        describe("withoutHistory toggle", () => {
            it("should return URL without history when history is currently true", () => {
                const result = buildToggleLink(baseUrl, { ...baseParams, includeHistory: true }, "withoutHistory");
                expect(result).not.toBeNull();
                expect(result).not.toContain("history=true");
            });

            it("should return null when history is already false", () => {
                const result = buildToggleLink(baseUrl, baseParams, "withoutHistory");
                expect(result).toBeNull();
            });

            it("should preserve metadata state when toggling history off", () => {
                const result = buildToggleLink(
                    baseUrl,
                    { ...baseParams, includeHistory: true, includeMetadata: true },
                    "withoutHistory",
                );
                expect(result).not.toContain("history=true");
                expect(result).toContain("metadata=true");
            });
        });

        describe("withMetadata toggle", () => {
            it("should return URL with metadata=true when metadata is currently false", () => {
                const result = buildToggleLink(baseUrl, baseParams, "withMetadata");
                expect(result).not.toBeNull();
                expect(result).toContain("metadata=true");
                expect(result).toContain("fields=title,authors");
            });

            it("should return null when metadata is already true", () => {
                const result = buildToggleLink(baseUrl, { ...baseParams, includeMetadata: true }, "withMetadata");
                expect(result).toBeNull();
            });

            it("should preserve history state when toggling metadata on", () => {
                const result = buildToggleLink(baseUrl, { ...baseParams, includeHistory: true }, "withMetadata");
                expect(result).toContain("metadata=true");
                expect(result).toContain("history=true");
            });
        });

        describe("withoutMetadata toggle", () => {
            it("should return URL without metadata when metadata is currently true", () => {
                const result = buildToggleLink(baseUrl, { ...baseParams, includeMetadata: true }, "withoutMetadata");
                expect(result).not.toBeNull();
                expect(result).not.toContain("metadata=true");
                expect(result).not.toContain("fields=");
            });

            it("should return null when metadata is already false", () => {
                const result = buildToggleLink(baseUrl, baseParams, "withoutMetadata");
                expect(result).toBeNull();
            });

            it("should preserve history state when toggling metadata off", () => {
                const result = buildToggleLink(
                    baseUrl,
                    { ...baseParams, includeHistory: true, includeMetadata: true },
                    "withoutMetadata",
                );
                expect(result).not.toContain("metadata=true");
                expect(result).toContain("history=true");
            });
        });
    });

    describe("buildPagination", () => {
        describe("basic pagination calculation", () => {
            it("should calculate hasNext and hasPrev correctly for first page", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.hasNext).toBe(true);
                expect(result.hasPrev).toBe(false);
            });

            it("should calculate hasNext and hasPrev correctly for middle page", () => {
                const result = buildPagination(baseUrl, {
                    page: 5,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.hasNext).toBe(true);
                expect(result.hasPrev).toBe(true);
            });

            it("should calculate hasNext and hasPrev correctly for last page", () => {
                const result = buildPagination(baseUrl, {
                    page: 10,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.hasNext).toBe(false);
                expect(result.hasPrev).toBe(true);
            });

            it("should handle single page correctly", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 5,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.hasNext).toBe(false);
                expect(result.hasPrev).toBe(false);
            });
        });

        describe("empty results", () => {
            it("should handle zero total correctly", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 0,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.total).toBe(0);
                expect(result.hasNext).toBe(false);
                expect(result.hasPrev).toBe(false);
                expect(result.links.prev).toBeNull();
                expect(result.links.next).toBeNull();
            });

            it("should set last page to 1 when total is 0", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 0,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                // Last page should be page 1, not page 0
                expect(result.links.last).toContain("page=1");
            });
        });

        describe("pagination links", () => {
            it("should generate correct self link", () => {
                const result = buildPagination(baseUrl, {
                    page: 3,
                    size: 20,
                    total: 100,
                    sort: "asc",
                    includeHistory: true,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.self).toContain("page=3");
                expect(result.links.self).toContain("size=20");
                expect(result.links.self).toContain("sort=asc");
                expect(result.links.self).toContain("history=true");
            });

            it("should generate correct first link", () => {
                const result = buildPagination(baseUrl, {
                    page: 5,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.first).toContain("page=1");
            });

            it("should generate correct prev link", () => {
                const result = buildPagination(baseUrl, {
                    page: 5,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.prev).toContain("page=4");
            });

            it("should set prev link to null on first page", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.prev).toBeNull();
            });

            it("should generate correct next link", () => {
                const result = buildPagination(baseUrl, {
                    page: 5,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.next).toContain("page=6");
            });

            it("should set next link to null on last page", () => {
                const result = buildPagination(baseUrl, {
                    page: 10,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.next).toBeNull();
            });

            it("should generate correct last link", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 95,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                // 95 items with size 10 = 10 pages
                expect(result.links.last).toContain("page=10");
            });

            it("should calculate last page correctly with exact division", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.last).toContain("page=10");
            });
        });

        describe("toggle links", () => {
            it("should include withHistory link when history is false", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.withHistory).not.toBeNull();
                expect(result.links.withoutHistory).toBeNull();
            });

            it("should include withoutHistory link when history is true", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: true,
                    includeMetadata: false,
                    metadataFields: [],
                });
                expect(result.links.withHistory).toBeNull();
                expect(result.links.withoutHistory).not.toBeNull();
            });

            it("should include withMetadata link when metadata is false", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: false,
                    metadataFields: ["title"],
                });
                expect(result.links.withMetadata).not.toBeNull();
                expect(result.links.withoutMetadata).toBeNull();
            });

            it("should include withoutMetadata link when metadata is true", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: true,
                    metadataFields: ["title"],
                });
                expect(result.links.withMetadata).toBeNull();
                expect(result.links.withoutMetadata).not.toBeNull();
            });
        });

        describe("state preservation in toggle links (bug fix verification)", () => {
            it("should preserve history state when generating withMetadata link", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: true,
                    includeMetadata: false,
                    metadataFields: ["title"],
                });
                // This was the bug: withMetadata link was losing history=true
                expect(result.links.withMetadata).toContain("history=true");
                expect(result.links.withMetadata).toContain("metadata=true");
            });

            it("should preserve history state when generating withoutMetadata link", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: true,
                    includeMetadata: true,
                    metadataFields: ["title"],
                });
                expect(result.links.withoutMetadata).toContain("history=true");
                expect(result.links.withoutMetadata).not.toContain("metadata=true");
            });

            it("should preserve metadata state when generating withHistory link", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: false,
                    includeMetadata: true,
                    metadataFields: ["title", "authors"],
                });
                expect(result.links.withHistory).toContain("metadata=true");
                expect(result.links.withHistory).toContain("history=true");
                expect(result.links.withHistory).toContain("fields=title,authors");
            });

            it("should preserve metadata state when generating withoutHistory link", () => {
                const result = buildPagination(baseUrl, {
                    page: 1,
                    size: 10,
                    total: 100,
                    sort: "asc",
                    includeHistory: true,
                    includeMetadata: true,
                    metadataFields: ["title", "authors"],
                });
                expect(result.links.withoutHistory).toContain("metadata=true");
                expect(result.links.withoutHistory).not.toContain("history=true");
                expect(result.links.withoutHistory).toContain("fields=title,authors");
            });
        });
    });

    describe("getPageIndices", () => {
        describe("ascending order", () => {
            it("should return correct indices for first page", () => {
                const result = getPageIndices({ page: 1, size: 3, total: 10, sort: "asc" });
                expect(result).toEqual([1, 2, 3]);
            });

            it("should return correct indices for second page", () => {
                const result = getPageIndices({ page: 2, size: 3, total: 10, sort: "asc" });
                expect(result).toEqual([4, 5, 6]);
            });

            it("should return correct indices for last partial page", () => {
                const result = getPageIndices({ page: 4, size: 3, total: 10, sort: "asc" });
                expect(result).toEqual([10]);
            });

            it("should handle exact page boundary", () => {
                const result = getPageIndices({ page: 3, size: 3, total: 9, sort: "asc" });
                expect(result).toEqual([7, 8, 9]);
            });
        });

        describe("descending order", () => {
            it("should return highest indices for first page", () => {
                const result = getPageIndices({ page: 1, size: 3, total: 10, sort: "desc" });
                expect(result).toEqual([10, 9, 8]);
            });

            it("should return correct indices for second page", () => {
                const result = getPageIndices({ page: 2, size: 3, total: 10, sort: "desc" });
                expect(result).toEqual([7, 6, 5]);
            });

            it("should return correct indices for last partial page", () => {
                const result = getPageIndices({ page: 4, size: 3, total: 10, sort: "desc" });
                expect(result).toEqual([1]);
            });

            it("should handle exact page boundary", () => {
                const result = getPageIndices({ page: 3, size: 3, total: 9, sort: "desc" });
                expect(result).toEqual([3, 2, 1]);
            });
        });

        describe("edge cases", () => {
            it("should return empty array when total is 0", () => {
                const result = getPageIndices({ page: 1, size: 10, total: 0, sort: "asc" });
                expect(result).toEqual([]);
            });

            it("should handle single item", () => {
                const resultAsc = getPageIndices({ page: 1, size: 10, total: 1, sort: "asc" });
                expect(resultAsc).toEqual([1]);

                const resultDesc = getPageIndices({ page: 1, size: 10, total: 1, sort: "desc" });
                expect(resultDesc).toEqual([1]);
            });

            it("should handle page size larger than total", () => {
                const result = getPageIndices({ page: 1, size: 100, total: 5, sort: "asc" });
                expect(result).toEqual([1, 2, 3, 4, 5]);
            });

            it("should handle page beyond data range (ascending)", () => {
                // Page 5 with size 10 and total 30 would start at index 41, which is beyond total
                const result = getPageIndices({ page: 5, size: 10, total: 30, sort: "asc" });
                expect(result).toEqual([]);
            });

            it("should handle page beyond data range (descending)", () => {
                // Page 5 with size 10 and total 30 would try to get items from 0 or negative
                const result = getPageIndices({ page: 5, size: 10, total: 30, sort: "desc" });
                expect(result).toEqual([]);
            });

            it("should handle large page numbers correctly", () => {
                const result = getPageIndices({ page: 1000, size: 20, total: 500, sort: "asc" });
                expect(result).toEqual([]);
            });
        });

        describe("real-world scenarios", () => {
            it("should generate correct DPID numbers for typical page", () => {
                // Simulating page 1 of DPIDs with 1000 total, showing newest first
                const result = getPageIndices({ page: 1, size: 20, total: 1000, sort: "desc" });
                expect(result.length).toBe(20);
                expect(result[0]).toBe(1000); // Highest DPID first
                expect(result[19]).toBe(981); // 20th item
            });

            it("should generate correct DPID numbers for typical ascending page", () => {
                // Page 1 ascending shows oldest first
                const result = getPageIndices({ page: 1, size: 20, total: 1000, sort: "asc" });
                expect(result.length).toBe(20);
                expect(result[0]).toBe(1); // Lowest DPID first
                expect(result[19]).toBe(20); // 20th item
            });
        });
    });
});
