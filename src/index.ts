import "dotenv/config";
import express, { type Express, type Request, type Response } from "express";
import { DpidReader, type DpidRequest } from "./dpid-reader/DpidReader.js";
import api from "./api/index.js";
import logger from "./logger.js";
import { pinoHttp } from "pino-http";
import analytics, { LogEventType } from "./analytics.js";
import {
    resolveGenericHandler,
    type ResolveGenericParams,
    type ResolveGenericQueryParams,
} from "./api/v2/resolvers/generic.js";

const allowlist = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:61440",
    "http://localhost:3002",
    "http://host.docker.internal:3000",
    "http://host.docker.internal:3002",
    "http://127.0.0.1:3000",
    "https://nodes.desci.com",
    "https://nodes-dev.desci.com",
    "https://nodes-demo.desci.com",
    "d2195goqok3wlx.amplifyapp.com",
    "d3ge8gcb3rt5iw.amplifyapp.com",
    "desci.com",
    "gitpod.io",
    "loca.lt" /** NOT SECURE */,
    "vercel.app" /** NOT SECURE */,
];

export const app: Express = express();
const port = process.env.PORT || 5460;

app.use(pinoHttp({ logger }));
app.use(express.json());

app.use(function (req, res, next) {
    // Handle CORS
    const origin = req.headers.origin;
    if (
        (origin && allowlist.indexOf(origin) !== -1) ||
        (origin && allowlist.filter((a) => a.indexOf("http") != 0 && origin && origin.endsWith(a)).length)
    ) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader(
            "Access-Control-Allow-Headers",
            "X-Requested-With,Content-Type,Authorization,sentry-trace,baggage",
        );
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS, PUT, DELETE");
        res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    next();
});

app.use("/api", api);

// Should probably check connectivity with ceramic/blockchain RPC/IPFS node
app.use("/healthz", async (_req, res) => res.send("OK"));

const legacyResolve = async (req: Request, res: Response) => {
    try {
        const path = req.params[0];

        if (["favicon.ico"].indexOf(path) > -1) {
            res.status(404).send();
            return;
        }

        const hostname = req.hostname;
        logger.info(`Resolving for ${hostname} path: ${path}`);

        const hostnameToPrefix: { [hostname: string]: string } = {
            "beta.dpid.org": "beta",
            "beta-dev.dpid.org": "beta",
            "staging-beta.dpid.org": "beta",
            "dev-beta.dpid.org": "beta",
            "dev-beta-dev.dpid": "beta",
        };
        const prefix = hostnameToPrefix[hostname] || "beta";

        logger.info("Prefix set to", prefix);

        const [dpid, ...extras] = path.split("/");
        if (dpid === undefined) {
            logger.error("dpid not specified");
            throw new Error("dpid not specified, pass dpid as route path");
        }
        const isRaw = Object.keys(req.query).indexOf("raw") > -1;
        const isJsonld = Object.keys(req.query).indexOf("jsonld") > -1;
        const [version, suffix] = extras ? [extras[0], extras.slice(1).join("/")] : [];
        const dpidRequest: DpidRequest = {
            dpid,
            version,
            suffix,
            prefix,
            raw: isRaw,
            jsonld: isJsonld,
            domain: hostname,
        };

        analytics.log({
            dpid: parseInt(dpid),
            version: parseInt(version ?? "0"),
            extra: dpidRequest,
            eventType: LogEventType.DPID_GET,
        });

        const dpidResult = await DpidReader.read(dpidRequest);
        if (dpidResult.id16 == "0x0") {
            logger.error("dpid not found");
            throw new Error("dpid not found");
        }
        const redir = await DpidReader.transform(dpidResult, dpidRequest);
        // res.send({ output, redir });
        if (dpidRequest.jsonld) {
            res.setHeader("Content-Type", "application/ld+json").send(redir);
            return;
        }
        if (typeof redir !== "string") {
            res.send(redir);
            return;
        }
        res.redirect(
            (redir as string).replace(
                "bafybeiamtbqbtq6xq3qmj7sod6dygilxn2eztlgy3p7xctje6jjjbsdah4/Data",
                "bafybeidmlofidcypbqcbjejpm6u472vbhwue2jebyrfnyymws644seyhdq",
            ),
        );
    } catch (err) {
        const error = err as Error;
        res.status(400).send({
            error: error.message,
            detail: error,
            params: req.params,
            query: req.query,
            path: "/*",
        });
        logger.error({ err }, "GET /* wildcard-error");
    }
};

app.get("/*", (req, res) => {
    if (process.env.FALLBACK_RESOLVER === "1") {
        return legacyResolve(req, res);
    } else {
        return resolveGenericHandler(
            req as Request<ResolveGenericParams, unknown, undefined, ResolveGenericQueryParams>,
            res,
        );
    }
});

app.listen(port, () => {
    logger.info(`⚡️[server]: Server is running at http://localhost:${port}`);
});
