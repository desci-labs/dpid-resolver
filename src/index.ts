import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';
import { DpidReader, DpidRequest } from './dpid-reader/DpidReader';

dotenv.config();

const app: Express = express();
const port = process.env.PORT;

app.get('/:dpid?/*', async (req: Request, res: Response) => {
    try {
        const { dpid, 0: extras } = req.params;
        const isRaw = Object.keys(req.query).indexOf('raw') > -1;
        const split = extras.split('/')
        const [version, suffix] = [split[0], split.slice(1).join('/')];
        const dpidRequest: DpidRequest = { dpid, version, suffix, prefix: "beta", raw: isRaw };
        const result = await DpidReader.read(dpidRequest);
        if (result == "AA=") {
            throw new Error("dpid not found")
        }
        const output = { msg: `beta.dpid.org resolver`, params: dpidRequest, result };
        const cleanVersion = version.substring(0, 1) == "v" ? parseInt(version.substring(1)) - 1 : version;
        const redir = `https://nodes.desci.com/${[result, cleanVersion, suffix].join('/')}`
        console.log("[dpid:resolve]", output);
        // res.send({ output, redir });
        res.redirect(redir);
    } catch (err) {
        res.status(400).send({ error: (err as any).message, detail: err })
    }
});

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});