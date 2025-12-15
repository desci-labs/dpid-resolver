# dPID Resolver

An open-source HTTP resolver for [dPID](https://dpid.org), bridging data from the decentralized protocols used for publishing to HTTP. The resolver handles requests for scientific research artifact data published on [CODEX](https://codex.desci.com), resolving data across Ceramic Network, on-chain smart contracts, and IPFS.

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
npm run dev

# Production build
npm run build
npm run start

# Code formatting and linting
npm run tidy

```

## Redis Setup (Optional but Recommended)

This project supports caching using Redis to improve response times and reduce load on the underlying data sources. If you want to enable Redis caching, follow these steps to set up a local Redis container using Docker:

1. **Start a Redis Container**

    Run the following command to start a Redis server in detached mode:

    ```bash
    docker run -d --name dpid-redis -p 6379:6379 redis:alpine
    ```

2. **Check if Redis is Running**

    Verify that the container is up and running:

    ```bash
    docker ps | grep dpid-redis
    ```

    You should see `dpid-redis` in the list of running containers.

3. **Test the Redis Connection**

    Make sure Redis responds to commands:

    ```bash
    docker exec dpid-redis redis-cli ping
    ```

    You should see the response:

    ```
    PONG
    ```

> **Note:**  
> If you are deploying to production or want to use an external Redis provider, make sure to configure the `REDIS_*` options in your `.env` file as described above.

## API Documentation

The API documentation is available at `/api-docs` when the server is running. This interactive documentation provides:

-   Detailed endpoint descriptions
-   Request/response schemas
-   Example requests and responses
-   Interactive testing interface

To access the documentation:

1. Start the server (`npm run dev` or `npm run start`)
2. Visit `http://localhost:5460/api-docs` (or your configured port)

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
