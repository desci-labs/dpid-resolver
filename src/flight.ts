import logger from "./logger.js";
import { CERAMIC_FLIGHT_URL } from "./util/config.js";

// Define proper interface for FlightSqlClient based on @ceramic-sdk/flight-sql-client
interface FlightSqlClient {
    // Flight SQL client for querying Ceramic streams
    // Based on @ceramic-sdk/flight-sql-client actual interface
    query: (query: string) => Promise<Buffer>;
    feedQuery: (query: string) => Promise<{ next(): Promise<Buffer | null> }>;
    preparedQuery: (query: string, params: Array<[string, string]>) => Promise<Buffer>;
    preparedFeedQuery: (query: string, params: Array<[string, string]>) => Promise<{ next(): Promise<Buffer | null> }>;
    getCatalogs: () => Promise<Buffer>;
    getDbSchemas: (options: { catalog?: string; includeSchema?: boolean }) => Promise<Buffer>;
    getTables: (options: { catalog?: string; includeSchema?: boolean }) => Promise<Buffer>;
}

export let flightClient: FlightSqlClient | undefined;

export async function maybeInitializeFlightClient(): Promise<void> {
    logger.info({ CERAMIC_FLIGHT_URL }, "CERAMIC_FLIGHT_URL");
    if (CERAMIC_FLIGHT_URL) {
        try {
            // Dynamic import to avoid issues in test environment
            const { newFlightSqlClient } = await import("@desci-labs/desci-codex-lib/c1/clients");
            flightClient = await newFlightSqlClient(CERAMIC_FLIGHT_URL);
        } catch (error) {
            logger.warn({ error }, "Failed to initialize Flight client, falling back to Ceramic");
            flightClient = undefined;
        }
    } else {
        logger.warn("No CERAMIC_FLIGHT_URL configured, skipping Flight client initialization");
    }
}
