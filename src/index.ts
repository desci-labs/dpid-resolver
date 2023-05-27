import express, { Express, Request, Response } from "express";
import dotenv from "dotenv";
import { DpidReader, DpidRequest } from "./dpid-reader/DpidReader";
import api from "./api";
dotenv.config();

const app: Express = express();
const port = process.env.PORT || 5469;

app.use("/api", api);

app.get("/*", async (req: Request, res: Response) => {
    try {
        const path = req.params[0];

        const hostname = req.hostname;
        console.log(`Resolving for ${hostname} path: ${path}`);

        const hostnameToPrefix: { [hostname: string]: string } = {
            "beta.dpid.org": "beta",
            "beta-dev.dpid.org": "beta-dev",
            "dev-beta.dpid.org": "beta",
            "dev-beta-dev.dpid": "beta-dev",
        };
        const prefix = hostnameToPrefix[hostname] || "beta";

        console.log("Prefix set to", prefix);

        const [dpid, ...extras] = path.split("/");
        if (dpid === undefined) {
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
        const dpidResult = await DpidReader.read(dpidRequest);
        if (dpidResult.id16 == "0x0") {
            throw new Error("dpid not found");
        }
        const redir = await DpidReader.transform(dpidResult, dpidRequest);
        // res.send({ output, redir });
        if (dpidRequest.jsonld) {
            res.setHeader("Content-Type", "application/ld+json").send(redir);
            return;
        }
        res.redirect(redir as string);
    } catch (err) {
        res.status(400).send({
            error: (err as any).message,
            detail: err,
            params: req.params,
            query: req.query,
        });
    }
});

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});
