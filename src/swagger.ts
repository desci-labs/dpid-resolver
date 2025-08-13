import swaggerJsdoc from "swagger-jsdoc";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDistBuild = process.env.NODE_ENV === "production" || __dirname.includes("dist");
const projectRoot = resolve(__dirname, "..");
const apisGlob = isDistBuild ? join(projectRoot, "dist/src/api/**/*.js") : join(projectRoot, "src/api/**/*.ts");

const options: swaggerJsdoc.Options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "dPID Resolver API",
            version: "2.0.0",
            description: `An open-source HTTP resolver for dPIDs, bridging decentralized protocols to HTTP for scientific research artifact data.

This API provides comprehensive endpoints to resolve dPIDs (decentralized Persistent Identifiers) to their corresponding manifests, content, and metadata. It powers both browse and detail page experiences for the decentralized research ecosystem.

## Key Use Cases

### Browse Pages
- **/api/v2/query/dpids** - Paginated lists of all research objects with optional metadata
- **Filter & sort** - Find research by recency, metadata fields, version activity  
- **Performance optimized** - Smart caching and optional metadata resolution

### Detail Pages
- **/api/v2/resolve/dpid/{id}** - Complete research object with full version history
- **/api/v2/resolve/{path}** - Flexible access to specific files and versions
- **Multi-format support** - JSON, raw IPFS, MyST, JSON-LD outputs

### Direct Access
- **User-friendly URLs** - Handle dpid.org/123 style links
- **Version navigation** - Access any historical version (v1, v2, etc.)
- **File-level access** - Direct links to papers, data, code within research objects

## Features
- **Fast Resolution**: Resolve dPIDs to manifests and content with sub-second response times
- **Version History**: Complete chronological access to all research object versions
- **Metadata Enrichment**: Optional IPFS manifest resolution for titles, authors, descriptions
- **Flexible Formats**: JSON APIs, raw IPFS redirects, MyST Markdown, JSON-LD semantic data
- **Pagination**: Efficient browsing through large research collections
- **Smart Caching**: Redis-backed performance optimization
- **Cross-Protocol**: Works with both Ceramic streams and legacy blockchain contracts

## Common Integration Patterns

**Research Discovery Platform:**
GET /api/v2/query/dpids?metadata=true&fields=title,authors&size=20

**Research Detail View:**
GET /api/v2/resolve/dpid/123
GET /api/v2/resolve/123/manuscript.pdf?format=raw

**Analytics Dashboard:**
GET /api/v2/query/dpids?history=true&size=100

## Authentication
This API is currently public and does not require authentication.

## Rate Limiting
Please be mindful of API usage. Rate limits may be applied to prevent abuse.

## Support
Questions? Check our GitHub Issues or contact support.`,
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
                url: "/api",
                description: "Current Host API",
            },
            {
                url: "http://localhost:5461/api",
                description: "Local Development Server",
            },
            {
                url: "https://dev-beta.dpid.org/api",
                description: "Development API",
            },
            {
                url: "https://beta.dpid.org/api",
                description: "Production API",
            },
        ],
        tags: [
            {
                name: "Resolve",
                description:
                    "**Individual research object resolution** - Perfect for detail pages, file access, and direct DPID links. Get complete research objects with full version history, specific files, or content in different formats (raw IPFS, MyST, JSON-LD).",
            },
            {
                name: "Query",
                description:
                    "**Research discovery and browse functionality** - Ideal for browse pages, search, and analytics. Paginated lists of research objects with optional metadata resolution, version history, and filtering capabilities.",
            },
        ],
    },
    apis: [apisGlob], // Path to the API docs
};

export const specs = swaggerJsdoc(options);
