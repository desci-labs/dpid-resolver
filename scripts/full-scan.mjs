#!/usr/bin/env node

/**
 * Full scan script for dpid-resolver API
 *
 * Scans all pages of the dpids list endpoint and reports statistics and anomalies.
 * Also useful to ensure cache is populated for every manifest and contract mapping.
 *
 * Usage:
 *   node scripts/full-scan.mjs <environment>
 *
 * Environment options:
 *   local - http://localhost:5460
 *   dev   - https://dev-beta.dpid.org
 *   prod  - https://beta.dpid.org
 */

const ENVIRONMENTS = {
    local: "http://localhost:5460",
    dev: "https://dev-beta.dpid.org",
    prod: "https://beta.dpid.org",
};

const COLORS = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

/**
 * Print usage information and exit
 */
function printUsage(exitCode = 0) {
    console.log(`
${c("bold", "dpid-resolver Full Scan")}

${c("cyan", "Usage:")}
  node scripts/full-scan.mjs <environment>

${c("cyan", "Environments:")}
  ${c("green", "local")} - ${ENVIRONMENTS.local}
  ${c("green", "dev")}   - ${ENVIRONMENTS.dev}
  ${c("green", "prod")}  - ${ENVIRONMENTS.prod}

${c("cyan", "Examples:")}
  node scripts/full-scan.mjs local   # Scan local environment
  node scripts/full-scan.mjs dev     # Scan dev environment
  node scripts/full-scan.mjs prod    # Scan production
`);
    process.exit(exitCode);
}

/**
 * Format milliseconds to human readable duration
 */
function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
}

/**
 * Draw a horizontal line
 */
function line(char = "─", length = 70) {
    return char.repeat(length);
}

/**
 * Pad string to fixed width
 */
function pad(str, width, align = "left") {
    const s = String(str);
    if (s.length >= width) return s.slice(0, width);
    const padding = " ".repeat(width - s.length);
    return align === "right" ? padding + s : s + padding;
}

/**
 * Print a table row
 */
function row(label, value, labelWidth = 30) {
    console.log(`  ${pad(label, labelWidth)} ${value}`);
}

/**
 * Fetch a single page from the API
 */
async function fetchPage(url) {
    const start = Date.now();
    try {
        const response = await fetch(url);
        const duration = Date.now() - start;

        if (!response.ok) {
            return {
                success: false,
                duration,
                error: `HTTP ${response.status}: ${response.statusText}`,
                url,
            };
        }

        const data = await response.json();
        return {
            success: true,
            duration,
            data,
            url,
        };
    } catch (error) {
        return {
            success: false,
            duration: Date.now() - start,
            error: error.message,
            url,
        };
    }
}

/**
 * Analyze a page for anomalies
 */
function analyzePageAnomalies(pageResult, pageNumber, expectedSize) {
    const anomalies = [];

    if (!pageResult.success) {
        anomalies.push({
            type: "request_failed",
            page: pageNumber,
            message: pageResult.error,
            severity: "error",
        });
        return anomalies;
    }

    const { data } = pageResult;
    const dpids = data.dpids || [];
    const isLastPage = !data.pagination?.links?.next;

    // Check for fewer dpids than expected (only on non-last pages)
    if (!isLastPage && dpids.length < expectedSize) {
        anomalies.push({
            type: "fewer_dpids",
            page: pageNumber,
            message: `Expected ${expectedSize} dpids, got ${dpids.length}`,
            severity: "warning",
        });
    }

    // Check each dpid for missing data
    for (const dpid of dpids) {
        // Check for missing history when requested
        if (data.pagination?.links?.withHistory === null && !dpid.versions) {
            anomalies.push({
                type: "missing_history",
                page: pageNumber,
                dpid: dpid.dpid,
                message: `DPID ${dpid.dpid} missing history data`,
                severity: "warning",
            });
        }

        // Check for missing metadata when requested
        if (data.pagination?.links?.withMetadata === null && !dpid.metadata) {
            anomalies.push({
                type: "missing_metadata",
                page: pageNumber,
                dpid: dpid.dpid,
                message: `DPID ${dpid.dpid} missing metadata`,
                severity: "warning",
            });
        }

        // Check for missing owner
        if (!dpid.owner) {
            anomalies.push({
                type: "missing_owner",
                page: pageNumber,
                dpid: dpid.dpid,
                message: `DPID ${dpid.dpid} has no owner`,
                severity: "warning",
            });
        }

        // Check for missing CID
        if (!dpid.latestCid) {
            anomalies.push({
                type: "missing_cid",
                page: pageNumber,
                dpid: dpid.dpid,
                message: `DPID ${dpid.dpid} has no latestCid`,
                severity: "error",
            });
        }
    }

    return anomalies;
}

/**
 * Main scan function
 */
async function runScan(environment) {
    const baseUrl = ENVIRONMENTS[environment];
    const startUrl = `${baseUrl}/api/v2/query/dpids?sort=asc&page=1&metadata=true&history=true`;

    console.log();
    console.log(c("bold", "╔" + line("═", 68) + "╗"));
    console.log(c("bold", "║") + pad("  dpid-resolver Full Scan", 68) + c("bold", "║"));
    console.log(c("bold", "╚" + line("═", 68) + "╝"));
    console.log();

    row("Environment", c("cyan", environment));
    row("Base URL", c("dim", baseUrl));
    row("Start Time", new Date().toISOString());
    console.log();
    console.log(c("dim", line()));
    console.log();

    const scanStart = Date.now();
    const stats = {
        pagesScanned: 0,
        totalDpids: 0,
        dpidsScanned: 0,
        ceramicDpids: 0,
        legacyDpids: 0,
        dpidsWithHistory: 0,
        dpidsWithMetadata: 0,
        requestTimes: [],
        failedRequests: 0,
    };
    const allAnomalies = [];

    let nextUrl = startUrl;
    let expectedSize = 20; // default page size

    // Progress indicator
    process.stdout.write(c("cyan", "  Scanning: "));

    while (nextUrl) {
        stats.pagesScanned++;
        const pageResult = await fetchPage(nextUrl);
        stats.requestTimes.push(pageResult.duration);

        // Progress dot
        if (pageResult.success) {
            process.stdout.write(c("green", "."));
        } else {
            process.stdout.write(c("red", "x"));
            stats.failedRequests++;
        }

        // Analyze anomalies
        const anomalies = analyzePageAnomalies(pageResult, stats.pagesScanned, expectedSize);
        allAnomalies.push(...anomalies);

        if (pageResult.success) {
            const { data } = pageResult;
            const dpids = data.dpids || [];

            // Update stats on first page
            if (stats.pagesScanned === 1) {
                stats.totalDpids = data.pagination?.total || 0;
                expectedSize = data.pagination?.size || 20;
            }

            stats.dpidsScanned += dpids.length;

            for (const dpid of dpids) {
                if (dpid.source === "ceramic") stats.ceramicDpids++;
                if (dpid.source === "legacy") stats.legacyDpids++;
                if (dpid.versions && dpid.versions.length > 0) stats.dpidsWithHistory++;
                if (dpid.metadata) stats.dpidsWithMetadata++;
            }

            // Get next page URL
            nextUrl = data.pagination?.links?.next || null;
        } else {
            // On failure, try to continue if we have pagination info
            nextUrl = null;
        }
    }

    const totalDuration = Date.now() - scanStart;
    console.log(); // End progress line
    console.log();

    // Calculate timing statistics
    const sortedTimes = [...stats.requestTimes].sort((a, b) => a - b);
    const avgTime = stats.requestTimes.reduce((a, b) => a + b, 0) / stats.requestTimes.length;
    const minTime = sortedTimes[0] || 0;
    const maxTime = sortedTimes[sortedTimes.length - 1] || 0;
    const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)] || 0;
    const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
    const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;

    // Print summary
    console.log(c("bold", "  Summary"));
    console.log(c("dim", "  " + line("─", 66)));
    row("Pages Scanned", stats.pagesScanned);
    row("Total DPIDs (reported)", stats.totalDpids);
    row("DPIDs Scanned", stats.dpidsScanned);
    row("Ceramic DPIDs", stats.ceramicDpids);
    row("Legacy DPIDs", stats.legacyDpids);
    row("DPIDs with History", stats.dpidsWithHistory);
    row("DPIDs with Metadata", stats.dpidsWithMetadata);
    row("Failed Requests", stats.failedRequests > 0 ? c("red", stats.failedRequests) : c("green", "0"));
    console.log();

    // Print timing statistics
    console.log(c("bold", "  Timing Statistics"));
    console.log(c("dim", "  " + line("─", 66)));
    row("Total Duration", formatDuration(totalDuration));
    row("Avg Request Time", formatDuration(Math.round(avgTime)));
    row("Min Request Time", formatDuration(minTime));
    row("Max Request Time", formatDuration(maxTime));
    row("P50 (Median)", formatDuration(p50));
    row("P95", formatDuration(p95));
    row("P99", formatDuration(p99));
    row("Throughput", `${(stats.dpidsScanned / (totalDuration / 1000)).toFixed(1)} dpids/sec`);
    console.log();

    // Print anomalies
    const errors = allAnomalies.filter((a) => a.severity === "error");
    const warnings = allAnomalies.filter((a) => a.severity === "warning");

    console.log(c("bold", "  Anomalies"));
    console.log(c("dim", "  " + line("─", 66)));

    if (allAnomalies.length === 0) {
        console.log(c("green", "  No anomalies detected!"));
    } else {
        row("Errors", errors.length > 0 ? c("red", errors.length) : c("green", "0"));
        row("Warnings", warnings.length > 0 ? c("yellow", warnings.length) : c("green", "0"));
        console.log();

        // Group anomalies by type for summary
        const byType = {};
        for (const anomaly of allAnomalies) {
            byType[anomaly.type] = (byType[anomaly.type] || 0) + 1;
        }

        console.log(c("bold", "  Anomaly Breakdown"));
        console.log(c("dim", "  " + line("─", 66)));
        for (const [type, count] of Object.entries(byType)) {
            const color = allAnomalies.find((a) => a.type === type)?.severity === "error" ? "red" : "yellow";
            row(type, c(color, count));
        }
        console.log();

        // Show first few anomalies of each type
        const MAX_SHOW = 5;
        const shownTypes = new Set();

        console.log(c("bold", "  Sample Anomalies (first " + MAX_SHOW + " of each type)"));
        console.log(c("dim", "  " + line("─", 66)));

        for (const anomaly of allAnomalies) {
            if (!shownTypes.has(anomaly.type)) {
                const sameType = allAnomalies.filter((a) => a.type === anomaly.type);
                const toShow = sameType.slice(0, MAX_SHOW);

                console.log();
                console.log(
                    `  ${anomaly.severity === "error" ? c("red", "●") : c("yellow", "●")} ${c("bold", anomaly.type)} (${sameType.length} total)`,
                );
                for (const a of toShow) {
                    console.log(`    ${c("dim", "→")} ${a.message}`);
                }
                if (sameType.length > MAX_SHOW) {
                    console.log(`    ${c("dim", `... and ${sameType.length - MAX_SHOW} more`)}`);
                }

                shownTypes.add(anomaly.type);
            }
        }
    }

    console.log();
    console.log(c("dim", line()));
    console.log();
    row("Scan Completed", new Date().toISOString());
    console.log();

    // Exit with error code if there were failures
    if (stats.failedRequests > 0 || errors.length > 0) {
        process.exit(1);
    }
}

// Parse arguments
const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
    printUsage();
}

const environment = args[0];

if (!environment) {
    console.error(c("red", `Error: Environment argument is required\n`));
    printUsage(1);
}

if (!ENVIRONMENTS[environment]) {
    console.error(c("red", `\nError: Unknown environment "${environment}"\n`));
    console.log(`Valid environments: ${Object.keys(ENVIRONMENTS).join(", ")}`);
    process.exit(1);
}

// Run the scan
runScan(environment).catch((error) => {
    console.error(c("red", `\nFatal error: ${error.message}`));
    process.exit(1);
});
