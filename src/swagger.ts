import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "dPID Resolver API",
            version: "2.0.0",
            description: `
                An open-source HTTP resolver for dPIDs, bridging decentralized protocols to HTTP for scientific research artifact data.

                ## Overview
                This API provides endpoints to resolve dPIDs (decentralized Persistent Identifiers) to their corresponding manifests and content.

                ## Features
                - Resolve dPIDs to manifests
                - Query research objects and version history
                - Support for multiple output formats (JSON, JSON-LD, MyST)

                ## Authentication
                This API is currently public and does not require authentication.

                ## Rate Limiting
                Please be mindful of API usage. Rate limits may be applied to prevent abuse.
            `,
            contact: {
                name: "API Support",
                url: "https://github.com/desci-labs/dpid-resolver/issues",
                email: "support@desci.com",
            },
            license: {
                name: "MIT",
                url: "https://opensource.org/licenses/MIT",
            },
        },
        servers: [
            {
                url: "https://beta.dpid.org/api",
                description: "Production API",
            },
            {
                url: "https://dev-beta.dpid.org/api",
                description: "Development API",
            },
            {
                url: "/api",
                description: "Localhost base API",
            },
        ],
        tags: [
            {
                name: "Resolve",
                description:
                    "Endpoints for resolving invidual research objects, by stream or dPID, to manifests and content",
            },
            {
                name: "Query",
                description: "Endpoints for querying research objects and version histories",
            },
        ],
    },
    apis: ["./src/api/**/*.ts"], // Path to the API docs
};

export const specs = swaggerJsdoc(options);
