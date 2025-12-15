import http from "http";
import https from "https";

/**
 * Shared HTTP/HTTPS agents with connection pooling for better performance under load.
 *
 * Without connection pooling, each axios request creates a new TCP connection,
 * which is expensive and limited by Node.js defaults (5 connections per host).
 *
 * With keepAlive enabled:
 * - Connections are reused across requests
 * - Reduces connection setup overhead
 * - Allows more concurrent requests to the same host
 * - Improves performance under high traffic
 *
 * ## Capacity Planning
 *
 * Per format=myst request with depth="full" and concurrency=8:
 * - ~8 concurrent IPFS fetches at any given time
 * - With maxSockets=50: can handle ~6 simultaneous format=myst requests comfortably
 * - 7-10 requests: some queueing but acceptable
 * - 15+ requests: significant queueing, risk of timeouts
 *
 * When pool is exhausted:
 * - Additional requests queue internally in Node.js agent
 * - Requests wait for a socket to become available
 * - If queued longer than request timeout (30s for fetchDagNode) → timeout error
 *
 * Note: Each IPFS gateway host has its own connection pool (primary + fallbacks)
 *
 * ## Configuration
 *
 * Environment variables (optional):
 * - HTTP_MAX_SOCKETS: Max concurrent connections per host (default: 50)
 * - HTTP_MAX_FREE_SOCKETS: Max idle connections to keep alive (default: 10)
 * - HTTP_SOCKET_TIMEOUT: Socket timeout in ms (default: 60000)
 *
 * Recommended settings by deployment size:
 * - Small (< 10 req/min): maxSockets=50 (default)
 * - Medium (10-50 req/min): maxSockets=100
 * - Large (50+ req/min): maxSockets=200, consider load balancing
 */

const maxSockets = process.env.HTTP_MAX_SOCKETS ? parseInt(process.env.HTTP_MAX_SOCKETS, 10) : 50;
const maxFreeSockets = process.env.HTTP_MAX_FREE_SOCKETS ? parseInt(process.env.HTTP_MAX_FREE_SOCKETS, 10) : 10;
const timeout = process.env.HTTP_SOCKET_TIMEOUT ? parseInt(process.env.HTTP_SOCKET_TIMEOUT, 10) : 60000;

export const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets,
    maxFreeSockets,
    timeout,
});

export const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets,
    maxFreeSockets,
    timeout,
});
