/**
 * This module tries to be a reference over UnixFS DagPB internals,
 * as well as our various hacks and abuses of the same.
 *
 * The types are rough approximations to communicate the basics, for more
 * details see the spec: https://specs.ipfs.tech/unixfs/#dag-pb-node
 *
 * Sorry to see you here, as it probably means you are debugging something
 * particularly nasty.
 */

/**
 * Link from DagPB Node to a child. A child is either:
 * - A directory (DagPB node with named links)
 * - A file node (i.e., a DagPbNode with unnamed children AND Data !== "CAE" )
 * - A raw block (unchunked file)
 */
export type PbLink = {
    /**
     * CID string. Notably:
     * - bafkrei... => raw codec    => target is unsharded raw file, no DagPB wrapper
     * - bafybei... => dag-pb codec => target is dir or file node
     */
    Hash: {
        "/": string;
    };
    /**
     * In dir node: filename of child
     * In file node: empty string (chunks/raw data block)
     */
    Name: string;
    /**
     * SHOULD (according to spec) be cumulative, recursive DAG size of linked object.
     * COULD (empirically) be 0 if the link is a directory.
     */
    Tsize: number;
};

/**
 * A DagPbNode comes in three flavours
 */
export type DagPbNode = {
    /**
     * DagPB Data message, encoded in base64. Important cases:
     * - CAE  => the node is a directory, see docs on MAGIC_UNIXFS_DIR_FLAG
     * - else => the node is a sharded file (or other exotic DagPB, but probably not)
     */
    Data: {
        "/": typeof MAGIC_UNIXFS_DIR_FLAG | string;
    };
    Links: PbLink[];
};

/**
 * Fun with IPLD/UnixFS part 4512:
 * - UnixFS data follows this protobuf schema: https://github.com/ipfs/specs/blob/main/UNIXFS.md#data-format
 * - Length-delimited protobuf encoding writes each fields as [size,data]
 * - The `Type` field is an enum, which is 8 bits long by default
 * - `Directory` has the enum value `1`
 * - [0x8,0x1] in base64 => CAE
 *
 * Hence, "CAE" obviously says "I'm a directory!"
 */
export const MAGIC_UNIXFS_DIR_FLAG = "CAE";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const magicIsUnixFsDir = (mysteriousData: any) => mysteriousData?.Data?.["/"]?.bytes === MAGIC_UNIXFS_DIR_FLAG;

/**
 * Check if a CID uses the raw codec (multicodec 0x55), meaning it's a leaf
 * file whose content IS the raw bytes — never a UnixFS directory.
 *
 * CIDv1 base32 encodes: <multibase><version><codec><multihash...>
 * "bafkrei" = base32lower 'b' + CIDv1 version 0x01 + raw codec 0x55 + sha2-256 0x1220.
 * Any CID starting with this prefix is guaranteed to be a raw file leaf.
 */
export const isRawCodecCid = (cid: string): boolean => cid.startsWith("bafkrei");

/**
 * Returns true if the Tsize of a link is 0, which might indicate it's a directory
 * with incorrect size set. Can be used to filter out files, but a true should probably
 * be followed up with a magicIsUnixFsDir call to make sure.
 */
export const hackyTsizeIsDir = (link: PbLink) => link.Tsize === 0;
