import { newCeramicClient, newComposeClient } from "@desci-labs/desci-codex-lib";
import { contracts, typechain as tc } from "@desci-labs/desci-contracts";
import { providers } from "ethers";

const getFromEnvOrThrow = (envvar: string) => {
    const val = process.env[envvar];
    if (!val) {
        throw new Error(`${envvar} required but not set`);
    }
    return val;
};

export const OPTIMISM_RPC_URL = getFromEnvOrThrow("OPTIMISM_RPC_URL");
export const IPFS_GATEWAY = getFromEnvOrThrow("IPFS_GATEWAY");
export const CERAMIC_URL = getFromEnvOrThrow("CERAMIC_URL");
export const DPID_ENV = getFromEnvOrThrow("DPID_ENV");

const VALID_ENVS = ["local", "dev", "staging", "production"];
if (!VALID_ENVS.includes(DPID_ENV)) {
    throw new Error(`Unsupported DPID_ENV: ${DPID_ENV}`);
}

const getOptimismProvider = () => new providers.JsonRpcProvider(OPTIMISM_RPC_URL);

export const getCeramicClient = () => newCeramicClient(CERAMIC_URL);

export const getComposeClient = () => newComposeClient({ ceramic: CERAMIC_URL });

const getAliasRegistryAddress = (): string => {
    switch (DPID_ENV) {
        case "local":
            return contracts.localDpidAliasInfo.proxies[0].address;
        case "dev":
            return contracts.devDpidAliasInfo.proxies[0].address;
        case "staging":
            return contracts.prodDpidAliasInfo.proxies[0].address;
        case "production":
            return contracts.prodDpidAliasInfo.proxies[0].address;
        default:
            throw new Error(`No dPID alias registry for DPID_ENV ${DPID_ENV}`);
    }
};

export const getDpidAliasRegistry = () =>
    tc.DpidAliasRegistry__factory.connect(getAliasRegistryAddress(), getOptimismProvider());

export const getNodesUrl = () => {
    switch (DPID_ENV) {
        case "local":
            return "http://localhost:3000";
        case "dev":
            return "https://nodes-dev.desci.com";
        case "staging":
            return "https://nodes.desci.com";
        case "production":
            return "https://nodes.desci.com";
        default:
            throw new Error(`No nodes URL available for DPID_ENV ${DPID_ENV}`);
    }
};

const ONE_WEEK = 60 * 60 * 24 * 7;
const TEN_MINUTES = 60 * 10;

/** Cache TTL for commits that have been anchored / finalized */
export const CACHE_TTL_ANCHORED = process.env.CACHE_TTL_ANCHORED ? parseInt(process.env.CACHE_TTL_ANCHORED) : ONE_WEEK;

/** Cache TTL for commits pending anchoring, i.e. hasn't got a timestamp */
export const CACHE_TTL_PENDING = process.env.CACHE_TTL_PENDING ? parseInt(process.env.CACHE_TTL_PENDING) : TEN_MINUTES;
