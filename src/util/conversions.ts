import { base16 } from "multiformats/bases/base16";
import { CID } from "multiformats/cid";

/** Strip did provider and eip155 chainId, leaving the standard hex address */
export const cleanupEip155Address = (eipAddress: string) => eipAddress.replace(/did:pkh:eip155:[0-9]+:/, "");

export const hexToCid = (hexCid: string) => {
    hexCid = hexCid.substring(2); // remove 0x
    hexCid = hexCid.length % 2 === 0 ? hexCid.substring(1) : hexCid;
    // const cidBytes = Buffer.from(hexCid, 'hex');

    const res2 = base16.decode(hexCid);
    const cid = CID.decode(res2);
    const cidString = cid.toString();

    return cidString;
};

export const safeHexToCid = (hex: string) => {
    return hex.length > 2 ? hexToCid(hex) : "";
};
