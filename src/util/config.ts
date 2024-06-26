import { newCeramicClient, newComposeClient } from "@desci-labs/desci-codex-lib";
import { contracts, typechain as tc } from "@desci-labs/desci-contracts";
import { providers } from "ethers";

const OPTIMISM_RPC_URL = process.env.OPTIMISM_RPC_URL;
const CERAMIC_URL = process.env.CERAMIC_URL;
const DPID_ENV = process.env.DPID_ENV;
const IPFS_GATEWAY = process.env.IPFS_GATEWAY;

const getOptimismProvider = () => {
    if (!OPTIMISM_RPC_URL) {
        throw new Error("OPTIMISM_RPC_URL not set");
    }
    return new providers.JsonRpcProvider(OPTIMISM_RPC_URL);
};

export const getCeramicClient = () => {
    if (!CERAMIC_URL) {
        throw new Error("CERAMIC_URL not set");
    }
    return newCeramicClient(CERAMIC_URL);
};

export const getComposeClient = () => {
    if (!CERAMIC_URL) {
        throw new Error("CERAMIC_URL not set");
    }

    return newComposeClient({ ceramic: CERAMIC_URL });
};

const VALID_ENVS = ["local", "dev", "staging", "production"];

const getDpidEnv = () => {
    if (!DPID_ENV) {
        throw new Error("DPID_ENV not set");
    }

    if (!VALID_ENVS.includes(DPID_ENV)) {
        throw new Error(`Unsupported DPID_ENV: ${DPID_ENV}`);
    }

    return DPID_ENV;
};

const getAliasRegistryAddress = (): string => {
    const env = getDpidEnv();
    switch (env) {
        case "local":
            return contracts.localDpidAliasInfo.proxies[0].address;
        case "dev":
            return contracts.devDpidAliasInfo.proxies[0].address;
        case "staging":
            return contracts.prodDpidAliasInfo.proxies[0].address;
        case "production":
            return contracts.prodDpidAliasInfo.proxies[0].address;
        default:
            throw new Error(`No dPID alias registry for DPID_ENV ${env}`);
    }
};

export const getDpidAliasRegistry = () =>
    tc.DpidAliasRegistry__factory.connect(getAliasRegistryAddress(), getOptimismProvider());

export const getNodesUrl = () => {
    const env = getDpidEnv();
    switch (env) {
        case "local":
            return "http://localhost:3000";
        case "dev":
            return "https://nodes-dev.desci.com";
        case "staging":
            return "https://nodes.desci.com";
        case "production":
            return "https://nodes.desci.com";
        default:
            throw new Error(`No nodes URL available for DPID_ENV ${env}`);
    }
};

export const getIpfsGateway = () => {
    if (!IPFS_GATEWAY) {
        throw new Error("IPFS_GATEWAY not set");
    }
    return IPFS_GATEWAY;
};
