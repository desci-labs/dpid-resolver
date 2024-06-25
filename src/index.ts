import dotenv from "dotenv";
dotenv.config({ path: "../" });
import express, { type Express } from "express";
import api from "./api/index.js";
import logger from "./logger.js";
import { pinoHttp } from "pino-http";
import { resolveGenericHandler } from "./api/v2/resolvers/generic.js";

export const app: Express = express();
const port = process.env.PORT || 5460;

app.use(pinoHttp({ logger }));

app.use("/api", api);
app.get("/*", resolveGenericHandler);

app.listen(port, () => {
    logger.info(`⚡️[server]: Server is running at http://localhost:${port}`);
});
