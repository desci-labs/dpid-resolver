import "dotenv/config";
import express, { type Express, type Request } from "express";
import * as Sentry from "@sentry/node";
import api from "./api/index.js";
import logger from "./logger.js";
import { pinoHttp } from "pino-http";
import {
    resolveGenericHandler,
    type ResolveGenericParams,
    type ResolveGenericQueryParams,
} from "./api/v2/resolvers/generic.js";
import swaggerUi from "swagger-ui-express";
import { specs } from "./swagger.js";
import { maybeInitializeRedis } from "./redis.js";
import { maybeInitializeFlightClient } from "./flight.js";
import { setupProcessHandlers } from "./process.js";
export const app: Express = express();
const port = process.env.PORT || 5460;

setupProcessHandlers();

// Initialize services
void Promise.all([
    maybeInitializeRedis().catch((err) => {
        logger.error({ err }, "Failed to initialize Redis service");
    }),
    maybeInitializeFlightClient().catch((err) => {
        logger.error({ err }, "Failed to initialize Flight client");
    }),
]);

// Should probably check connectivity with ceramic/blockchain RPC/IPFS node
app.use("/healthz", async (_req, res) => res.send("OK"));

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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    next();
});

// Serve the OpenAPI JSON and the interactive API docs
app.get("/api-docs.json", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json(specs);
});
app.use("/api-docs", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});
app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
        swaggerUrl: "/api-docs.json?v=2",
        swaggerOptions: {
            displayOperationId: false,
        },
    }),
);

app.use("/api", api);

app.get("/*", (req, res) =>
    resolveGenericHandler(req as Request<ResolveGenericParams, unknown, undefined, ResolveGenericQueryParams>, res),
);

Sentry.setupExpressErrorHandler(app);

app.listen(port, () => {
    logger.info(`⚡️[server]: Server is running at http://localhost:${port}`);
});
