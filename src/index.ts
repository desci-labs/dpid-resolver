import "dotenv/config";
import express, { type Express, type Request } from "express";
import api from "./api/index.js";
import logger from "./logger.js";
import { pinoHttp } from "pino-http";
import {
    resolveGenericHandler,
    type ResolveGenericParams,
    type ResolveGenericQueryParams,
} from "./api/v2/resolvers/generic.js";
import { createRedisService, shouldStartRedis, type RedisService } from "./redis.js";
import { CERAMIC_FLIGHT_URL } from "./util/config.js";
import { newFlightSqlClient, FlightSqlClient } from "@desci-labs/desci-codex-lib/c1/clients";
import swaggerUi from "swagger-ui-express";
import { specs } from "./swagger.js";

export const app: Express = express();
const port = process.env.PORT || 5460;

// Initialize Redis if configured
export let redisService: RedisService | undefined;
if (shouldStartRedis()) {
    redisService = createRedisService({
        host: process.env.REDIS_HOST!,
        port: parseInt(process.env.REDIS_PORT!),
    });
    redisService.start().catch((err) => {
        logger.error({ err }, "Failed to start Redis service");
    });
}

export let flightClient: FlightSqlClient;
if (CERAMIC_FLIGHT_URL) {
    flightClient = await newFlightSqlClient(CERAMIC_FLIGHT_URL);
}

app.use(pinoHttp({ logger }));
app.use(express.json());

/** Wide open, since it:
 * - only resolves public information
 * - doesn't implement any type of auth
 * - should be generally available to the public
 */
app.use(function (_req, res, next) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
});

// Serve the interactive API docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.use("/api", api);

// Should probably check connectivity with ceramic/blockchain RPC/IPFS node
app.use("/healthz", async (_req, res) => res.send("OK"));

app.get("/*", (req, res) =>
    resolveGenericHandler(req as Request<ResolveGenericParams, unknown, undefined, ResolveGenericQueryParams>, res),
);

app.listen(port, () => {
    logger.info(`⚡️[server]: Server is running at http://localhost:${port}`);
});
