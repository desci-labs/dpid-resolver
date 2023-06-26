import dotenv from "dotenv";
dotenv.config({ path: "../" });
import express, { Express, Request, Response } from "express";
import { DataResponse, DpidReader, DpidRequest } from "./dpid-reader/DpidReader";
import api from "./api";
import logger from "logger";
import pinoHttp from "pino-http";
import analytics, { LogEventType } from "analytics";

const app: Express = express();
const port = process.env.PORT || 5460;

app.use(pinoHttp({ logger }));

app.use("/api", api);

app.get("/*", async (req: Request, res: Response) => {
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
            "beta-dev.dpid.org": "beta-dev",
            "dev-beta.dpid.org": "beta",
            "dev-beta-dev.dpid": "beta-dev",
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
        };

        analytics.log({
            dpid: parseInt(dpid),
            version: parseInt(version!),
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
        res.redirect(redir as string);
    } catch (err) {
        res.status(400).send({
            error: (err as any).message,
            detail: err,
            params: req.params,
            query: req.query,
            path: "/*",
        });
        logger.error({ err }, "GET /* wildcard-error");
    }
});

app.listen(port, () => {
    logger.info(`⚡️[server]: Server is running at http://localhost:${port}`);
});
