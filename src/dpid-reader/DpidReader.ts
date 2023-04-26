const RPC_URL =
  "https://eth-goerli.g.alchemy.com/v2/GWLETGKsYgp0W7Z2IO8__3BEOM2KXiP8";
//'https://goerli.infura.io/v3/';
import { AlchemyEth, createAlchemyWeb3 } from "@alch/alchemy-web3";
import contract from "../deployments/goerli/config.json";
import { encode, decode } from "url-safe-base64";
import { getIndexedResearchObjects } from "./TheGraphResolver";
import { base16 } from "multiformats/bases/base16";
import { CID } from "multiformats/cid";

export interface DpidRequest {
  dpid: string;
  version?: string;
  suffix?: string;
  prefix: string;
  raw?: boolean;
}

// export const encodeBase64UrlSafe = (bytes: Buffer) => {
//     return encode(Buffer.from(bytes).toString('base64'));
//   };
// export const convertUUIDToHex = (uuid: string) => {
//   const decoded = decode(uuid + ".");
//   const buffer = Base64Binary.decodeArrayBuffer(decoded).slice(0, 32);
//   let base64UuidToBase16 = Buffer.from(buffer).toString("hex");
//   base64UuidToBase16 =
//     "0x" +
//     (base64UuidToBase16.length % 2 == 0
//       ? base64UuidToBase16
//       : "0" + base64UuidToBase16);

//   return base64UuidToBase16;
// };
export const convertHexTo64PID = (hex: string, hexToBytes: any) => {
  const bytes: number[] = hexToBytes(hex);

  const base64encoded = Buffer.from(bytes).toString("base64");
  const base64SafePID = encode(base64encoded).replace(/[\.=]$/, "");
  return base64SafePID;
};

const DEFAULT_IPFS_GATEWAY = "https://ipfs.desci.com/ipfs";

// the value of string "beta" in bytes32 encoded as hex
const PREFIX_HARDCODE_BETA =
  "0x6265746100000000000000000000000000000000000000000000000000000000";

const THE_GRAPH_RESOLVER_URL: { [key: string]: string } = {
  beta: "https://graph-goerli-stage.desci.com/subgraphs/name/nodes",
};

interface ContractConfig {
  address: string;
  abi: any;
}

interface DpidResult {
  id16: string;
  id64: string;
}

interface GraphResultVersion {
  id: string;
  cid: string;
  time: string;
}

interface GraphResult {
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

export class DpidReader {
  static read = async ({
    dpid,
    version,
    suffix,
    prefix,
  }: DpidRequest): Promise<DpidResult> => {
    const web3 = createAlchemyWeb3(RPC_URL);

    const dpidRegistryContract = new web3.eth.Contract(
      contract.abi as any,
      contract.address
    );
    const targetUuid = await dpidRegistryContract.methods
      .get(PREFIX_HARDCODE_BETA, dpid)
      .call();
    console.log("got uuid", targetUuid);

    const hexUuid = web3.utils.numberToHex(targetUuid);
    console.log("hexUuid", hexUuid);
    const hexToPid = convertHexTo64PID(hexUuid, web3.utils.hexToBytes);
    console.log("pid", hexToPid);

    return { id64: hexToPid, id16: hexUuid };
  };

  private static transformWeb = async (
    result: DpidResult,
    request: DpidRequest
  ) => {
    const { prefix, suffix, version } = request;
    const uuid = result.id64;
    const output = { msg: `beta.dpid.org resolver`, params: request, uuid };

    // TODO: support version=v1 syntax in Nodes and we can get rid of cleanVersion logic
    const cleanVersion =
      version?.substring(0, 1) == "v"
        ? parseInt(version!.substring(1)) - 1
        : version;
    const redir = `https://nodes${
      prefix === "beta-dev" ? "-dev" : ""
    }.desci.com/${[uuid, cleanVersion, suffix].filter(Boolean).join("/")}`;
    console.log("[dpid:resolve]", output);
    return redir;
  };

  private static transformRaw = async (
    result: DpidResult,
    request: DpidRequest
  ) => {
    const { prefix, suffix, version } = request;
    const hex = result.id16;
    const output = { msg: `beta.dpid.org resolver`, params: request, hex };

    const graphUrl = THE_GRAPH_RESOLVER_URL[prefix];
    const graphResult: GraphResult = (
      await getIndexedResearchObjects(graphUrl, [hex])
    ).researchObjects[0];

    console.log("GRAPHRES", graphUrl, hex, JSON.stringify(graphResult));

    // TODO: support version=v1 syntax in Nodes and we can get rid of cleanVersion logic and can pass the version identifier straight through
    let cleanVersion: number | undefined = undefined;
    if (version) {
      cleanVersion =
        version?.substring(0, 1) == "v"
          ? parseInt(version!.substring(1)) - 1
          : parseInt(version);
    }

    console.log("CLEAN VER", cleanVersion, version);
    // if no version specified, use latest
    if (!cleanVersion) {
      console.log("totalver", graphResult);
      cleanVersion = graphResult.versions.length - 1;
      console.log("set clean ver", cleanVersion);
    }

    const targetVersion = graphResult.versions[cleanVersion!];

    console.log("got target", targetVersion);

    if (!targetVersion || !targetVersion.cid) {
      throw new Error(
        "incorrect version, to get the first version use either 'v1' or '0', to get the second version use either 'v2' or '1', to get the latest, don't pass any suffix"
      );
    }

    const targetCid = hexToCid(targetVersion.cid);

    console.log("targetCid", targetCid);

    // const redir = `https://nodes.desci.com/${[uuid, cleanVersion, suffix].filter(Boolean).join('/')}`
    // console.log("[dpid:resolve]", output);
    // return redir;
    // throw new Error("nodes resolution fail")
    return `${DEFAULT_IPFS_GATEWAY}/${targetCid}`;
  };

  static transform = async (result: DpidResult, request: DpidRequest) => {
    if (request.raw) {
      console.log("[DpidReader::transform] raw", request);
      return DpidReader.transformRaw(result, request);
    }
    console.log("[DpidReader::transform] web", request);
    return DpidReader.transformWeb(result, request);
  };
}
