import logger from "./logger.js";
import { CERAMIC_FLIGHT_URL } from "./util/config.js";

export let flightClient: unknown | undefined;

export async function maybeInitializeFlightClient(): Promise<void> {
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
