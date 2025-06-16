# dPID Resolver

An open-source HTTP resolver for [dPID](https://dpid.org), bridging data the decentralized protocols used for data resolution to HTTP. The resolver handles requests for scientific research artifact data published on [CODEX](https://codex.desci.com), resolving data across Ceramic Network, on-chain smart contracts, and IPFS.

[DeSci Labs](https://desci.com) hosts two public resolvers:

-   https://beta.dpid.org (mainnet)
-   https://dev-beta.dpid.org/ (testnet)

## Overview

-   Resolves dPIDs (short identifiers for CODEX IDs/Ceramic stream IDs) to their corresponding data
-   Exposes HTTP endpoints for accessing decentralized data
-   Supports caching via Redis for improved performance
-   Configurable for both mainnet and testnet environments

## Configuration

Copy `.env.example` to `.env` and configure the following options:

### Required

-   `DPID_ENV`: Environment configuration (mainnet/testnet)
-   `OPTIMISM_RPC_URL`: RPC URL for Optimism Sepolia network
-   `CERAMIC_URL`: js-ceramic/composeDB node URL (if `CERAMIC_FLIGHT_URL` is set, this is ignored)

### Optional

-   `CERAMIC_FLIGHT_URL`: If set, exclusively uses ceramic-one for stream resolution
-   `SUPABASE_URL/PORT`: For analytics tracking
-   `REDIS_*`: Redis configuration for caching stream/commit state
    -   `CACHE_TTL_ANCHORED`: Cache duration for finalized commits (default: 1 week)
    -   `CACHE_TTL_PENDING`: Cache duration for unfinalized commits (default: 10 minutes)

## Development

```bash
# Install dependencies
npm ci

# Run tests (uses live data from dPID dev environment)
npm run test

# Development mode with hot reload
npm run watch

# Production build
npm run build
npm run start

# Code formatting and linting
npm run tidy
```

## Docker Deployment

```bash
# Build the image
docker build . -t dpid.org/dpid-resolver

# Run the container
docker run dpid.org/dpid-resolver
```

## Related Projects

-   [dPID Smart Contracts](https://github.com/desci-labs/nodes/tree/develop/desci-contracts)
-   [CODEX](https://codex.desci.com)
-   [IPFS](https://ipfs.tech/)
