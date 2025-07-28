/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import { createAlchemyWeb3 } from "@alch/alchemy-web3";
import sepoliaDevContract from "../deployments/sepoliaDev/config.json" assert { type: "json" };
import sepoliaProdContract from "../deployments/sepoliaProd/config.json" assert { type: "json" };
import { encode } from "url-safe-base64";
import { getIndexedResearchObjects } from "./TheGraphResolver.js";
// @ts-ignore
import { base16 } from "multiformats/bases/base16";
// @ts-ignore
import { CID } from "multiformats/cid";
import axios from "axios";
import {
    type DataBucketComponent,
    MystTransformer,
    type ResearchObjectV1,
    type ResearchObjectV1Component,
    RoCrateTransformer,
} from "@desci-labs/desci-models";
import parentLogger from "../logger.js";

const logger = parentLogger.child({ module: "DpidReader" });
export interface DpidRequest {
    dpid: string;
    version?: string;
    suffix?: string;
    prefix: string;
    /** @deprecated use format instead */
    raw?: boolean;
    /** @deprecated use format instead */
    jsonld?: boolean;
    domain?: string;
    format?: "jsonld" | "json" | "raw" | "myst";
}

const RPC_URL = "https://eth-sepolia.g.alchemy.com/v2/Dg4eT90opKOFZ7w-YCxVwX9O-sriKn0N";

export const convertHexTo64PID = (hex: string, hexToBytes: any) => {
    const bytes: number[] = hexToBytes(hex);

    const base64encoded = Buffer.from(bytes).toString("base64");
    const base64SafePID = encode(base64encoded).replace(/[.=]$/, "");
    return base64SafePID;
};

export const DEFAULT_IPFS_GATEWAY = "https://ipfs.desci.com/ipfs";

// the value of string "beta" in bytes32 encoded as hex
export const PREFIX_HARDCODE_BETA = "0x6265746100000000000000000000000000000000000000000000000000000000";

export const THE_GRAPH_RESOLVER_URL: { [key: string]: string } =
    process.env.DPID_ENV === "dev"
        ? {
              beta: "https://graph-sepolia-dev.desci.com/subgraphs/name/nodes",
              __registry: "https://graph-sepolia-dev.desci.com/subgraphs/name/dpid-registry",
          }
        : process.env.DPID_ENV === "staging"
          ? {
                beta: "https://graph-sepolia-prod.desci.com/subgraphs/name/nodes",
                __registry: "https://graph-sepolia-prod.desci.com/subgraphs/name/dpid-registry",
            }
          : {
                beta: "https://graph-sepolia-prod.desci.com/subgraphs/name/nodes",
                __registry: "https://graph-sepolia-prod.desci.com/subgraphs/name/dpid-registry",
            };

logger.info({
    THE_GRAPH_RESOLVER_URL,
    PREFIX_HARDCODE_BETA,
    DEFAULT_IPFS_GATEWAY,
});

interface DpidResult {
    id16: string;
    id64: string;
}

interface GraphResultVersion {
    id: string;
    cid: string;
    time: string;
}

export interface GraphResult {
    id: string;
    id10: string;
    recentCid: string;
    owner: string;
    versions: GraphResultVersion[];
}

export const hexToCid = (hexCid: string) => {
    hexCid = hexCid.substring(2); // remove 0x
    hexCid = hexCid.length % 2 === 0 ? hexCid.substring(1) : hexCid;
    // const cidBytes = Buffer.from(hexCid, 'hex');

    const res2 = base16.decode(hexCid);
    const cid = CID.decode(res2);
    const cidString = cid.toString();

    return cidString;
};

export interface DataResponse {
    data: object;
}
export class DpidReader {
    static read = async ({ dpid }: DpidRequest): Promise<DpidResult> => {
        const web3 = createAlchemyWeb3(RPC_URL);

        const dpidRegistryContract =
            process.env.DPID_ENV === "dev"
                ? new web3.eth.Contract(sepoliaDevContract.abi as any, sepoliaDevContract.address)
                : new web3.eth.Contract(sepoliaProdContract.abi as any, sepoliaProdContract.address);
        const targetUuid = await dpidRegistryContract.methods.get(PREFIX_HARDCODE_BETA, dpid).call();
        logger.info({ targetUuid }, "got uuid");

        let hexUuid = web3.utils.numberToHex(targetUuid);
        // fix padding
        if (hexUuid.length % 2 === 1) {
            hexUuid = hexUuid.replace("0x", "0x0");
        }
        logger.info({ hexUuid }, "hexUuid");
        const hexToPid = convertHexTo64PID(hexUuid, web3.utils.hexToBytes);
        logger.info({ hexToPid }, "pid");

        return { id64: hexToPid, id16: hexUuid };
    };

    private static transformWeb = async (result: DpidResult, request: DpidRequest) => {
        const { prefix, suffix, version, domain } = request;
        const uuid = result.id64;
        // debugger;
        const output = { msg: `beta.dpid.org resolver`, params: request, uuid };

        // TODO: support version=v1 syntax in Nodes and we can get rid of cleanVersion logic
        let cleanVersion: string | undefined = !version
            ? undefined
            : version?.substring(0, 1) == "v"
              ? version
              : `v${parseInt(version || "0") + 1}`;

        if (cleanVersion === "vNaN") {
            /**
             ** Not a valid version, so pass along the original string the user entered, it may route to other
             ** codex entities or the DPID may be an alias to another external non research object entity.
             */
            cleanVersion = version;
        }

        let environment = prefix === "beta-dev" || domain === "dev-beta.dpid.org" ? "-dev" : "";
        if (domain === "staging-beta.dpid.org") {
            environment = "-staging";
        }

        const redir = `https://nodes${environment}.desci.com/dpid/${[request.dpid, cleanVersion, suffix]
            .filter(Boolean)
            .join("/")}`;
        logger.info({ output }, "[dpid:resolve]");
        return redir;
    };

    private static transformRaw = async (result: DpidResult, request: DpidRequest): Promise<string | DataResponse> => {
        const { prefix, suffix, version } = request;
        const hex = result.id16;

        const graphUrl = THE_GRAPH_RESOLVER_URL[prefix];
        const graphResult: GraphResult = (await getIndexedResearchObjects(graphUrl, [hex])).researchObjects[0];

        logger.info({ graphUrl, hex, graphResult }, "GRAPHRES");

        // TODO: support version=v1 syntax in Nodes and we can get rid of cleanVersion logic and can pass the version identifier straight through
        let cleanVersion: number | undefined = undefined;
        if (version) {
            cleanVersion = version?.substring(0, 1) == "v" ? parseInt(version.substring(1)) - 1 : parseInt(version);
        }

        logger.debug({ cleanVersion, version }, "CLEAN VER");
        // if no version specified, use latest
        if (cleanVersion === undefined || isNaN(cleanVersion)) {
            logger.debug({ graphResult }, "totalver");
            cleanVersion = graphResult.versions.length - 1;
            logger.debug({ cleanVersion }, "set clean ver");
        }

        const targetVersion = graphResult.versions[graphResult.versions.length - 1 - cleanVersion];

        logger.info({ targetVersion }, "got target");

        if (!targetVersion || !targetVersion.cid) {
            throw new Error(
                "incorrect version, to get the first version use either 'v1' or '0', to get the second version use either 'v2' or '1', to get the latest, don't pass any suffix",
            );
        }

        const targetCid = hexToCid(targetVersion.cid);

        logger.info({ targetCid }, "targetCid");

        const manifestLocation = `${DEFAULT_IPFS_GATEWAY}/${targetCid}`;
        const dataRootString = version && ["data", "root"].indexOf(version) > -1 ? version : false;
        const versionAsData = !!dataRootString;
        if (
            versionAsData ||
            (suffix && (suffix.indexOf("data") === 0 || suffix.indexOf(`/data`) === 0)) ||
            (suffix && (suffix.indexOf("root") === 0 || suffix.indexOf(`/root`) === 0))
        ) {
            const res = await fetch(manifestLocation);
            const researchObject: ResearchObjectV1 = await res.json();
            const dataBucketCandidate: ResearchObjectV1Component =
                researchObject.components.find((a) => a.name == "root") || researchObject.components[0];
            if (dataBucketCandidate) {
                const dataBucket: DataBucketComponent = dataBucketCandidate as DataBucketComponent;
                let dataSuffix;
                if (versionAsData) {
                    dataSuffix = suffix;
                } else {
                    dataSuffix = suffix?.replace(/^(root|data)/, "");
                }
                dataSuffix = dataSuffix?.replace(/^\//, "");

                const arg = `${dataBucket.payload.cid}${dataSuffix ? `/${dataSuffix}` : ""}`
                    .replace("?raw", "")
                    // temporary logic to reroute to a different IPFS gateway for certain datasets
                    .replace(
                        "bafybeiamtbqbtq6xq3qmj7sod6dygilxn2eztlgy3p7xctje6jjjbsdah4/Data",
                        "bafybeidmlofidcypbqcbjejpm6u472vbhwue2jebyrfnyymws644seyhdq",
                    )
                    // temporary logic to reroute to a different IPFS gateway for certain datasets
                    .replace(
                        "bafybeibi6wxfwa6mw5xlctezx2alaq4ookmld25pfqy3okbnfz4kkxtk4a/Data",
                        "bafybeidmlofidcypbqcbjejpm6u472vbhwue2jebyrfnyymws644seyhdq",
                    );
                logger.info({ arg, dataBucket }, "arg");

                // temporary logic to reroute to a different IPFS gateway for certain datasets
                const CID_MAP: { [key: string]: string } = {
                    bafybeiamtbqbtq6xq3qmj7sod6dygilxn2eztlgy3p7xctje6jjjbsdah4: "https://ipfs.io/ipfs",
                    bafybeibi6wxfwa6mw5xlctezx2alaq4ookmld25pfqy3okbnfz4kkxtk4a: "https://ipfs.io/ipfs",
                };
                const defaultGateway = DEFAULT_IPFS_GATEWAY;
                const selectedGateway =
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    (dataSuffix!.length > 0 ? CID_MAP[dataBucket.payload.cid] : defaultGateway) || defaultGateway;
                const dagTestURl = `${selectedGateway.replace(/\/ipfs$/, "")}/api/v0/dag/get?arg=${arg}`;
                try {
                    const { data } = await axios({ method: "POST", url: dagTestURl });
                    if (!data.Data || data.Data["/"].bytes !== "CAE") {
                        return `${selectedGateway}/${arg}`;
                    } else {
                        return data;
                    }
                } catch (err) {
                    logger.error(err);
                    throw new Error("data could not be resolved: check the path and version");
                }
            }
            throw new Error(
                "data resolution fail: data folder not found in manifest. ensure data folder has been allocated.",
            );
        }
        // const redir = `https://nodes.desci.com/${[uuid, cleanVersion, suffix].filter(Boolean).join('/')}`
        // logger.info({output},"[dpid:resolve]");
        // return redir;
        // throw new Error("nodes resolution fail")
        return `${DEFAULT_IPFS_GATEWAY}/${targetCid}`;
    };

    private static transformJsonld = async (result: DpidResult, request: DpidRequest) => {
        const rawRes = (await this.transformRaw(result, request)) as string;
        const resJson = await axios.get(rawRes);
        const transformer = new RoCrateTransformer();

        const roCrate = transformer.exportObject(resJson.data);

        return JSON.stringify(roCrate);
    };

    private static transformMyst = async (result: DpidResult, request: DpidRequest) => {
        const rawRes = (await this.transformRaw(result, request)) as string;
        const resJson = await axios.get(rawRes);
        const transformer = new MystTransformer();
        const mystOutput = transformer.exportObject(resJson.data);
        return mystOutput;
    };

    static transform = async (result: DpidResult, request: DpidRequest) => {
        if (request.jsonld) {
            logger.info({ request }, "[DpidReader::transform] jsonld");
            return DpidReader.transformJsonld(result, request);
        }
        if (request.raw) {
            logger.info({ request }, "[DpidReader::transform] raw");
            return DpidReader.transformRaw(result, request);
        }
        if (request.format === "myst") {
            logger.info({ request }, "[DpidReader::transform] myst");
            return DpidReader.transformMyst(result, request);
        }
        logger.info({ request }, "[DpidReader::transform] web");
        return DpidReader.transformWeb(result, request);
    };
}
