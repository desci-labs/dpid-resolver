const RPC_URL = 'https://eth-goerli.g.alchemy.com/v2/GWLETGKsYgp0W7Z2IO8__3BEOM2KXiP8';
//'https://goerli.infura.io/v3/';
import { createAlchemyWeb3 } from "@alch/alchemy-web3";
import contract from "../deployments/goerli/config.json"
import { encode, decode } from 'url-safe-base64';
import Base64Binary from "../Base64Binary";

export interface DpidRequest {
    dpid: string;
    version?: string;
    suffix?: string;
    prefix: string;
    raw?:boolean;
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
    const bytes:number[] = hexToBytes(hex);
  
    const base64encoded = Buffer.from(bytes).toString("base64");
    const base64SafePID = encode(base64encoded).replace(/[\.=]$/, "");
    return base64SafePID;
  };
  

export class DpidReader {
    static read = async ({ dpid, version, suffix, prefix }: DpidRequest) => {
        const web3 = createAlchemyWeb3(RPC_URL);

        // the value of string "beta" in bytes32 encoded as hex
        const PREFIX_HARDCODE_BETA = "0x6265746100000000000000000000000000000000000000000000000000000000";

        const dpidRegistryContract = new web3.eth.Contract(contract.abi as any, contract.address);
        const targetUuid = await dpidRegistryContract.methods.get(PREFIX_HARDCODE_BETA, dpid).call();
        console.log("got uuid", targetUuid);
        
        const hexUuid = web3.utils.numberToHex(targetUuid)
        console.log("hexUuid", hexUuid);
        const hexToPid = convertHexTo64PID(hexUuid, web3.utils.hexToBytes);
        console.log("pid", hexToPid);
        
        return hexToPid;
    }
}