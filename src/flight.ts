import logger from "./logger.js";
import { CERAMIC_FLIGHT_URL } from "./util/config.js";
import { newFlightSqlClient, FlightSqlClient } from "@desci-labs/desci-codex-lib/c1/clients";

export let flightClient: FlightSqlClient | undefined;

export async function maybeInitializeFlightClient(): Promise<void> {
    if (CERAMIC_FLIGHT_URL) {
        flightClient = await newFlightSqlClient(CERAMIC_FLIGHT_URL);
    } else {
        logger.warn("No CERAMIC_FLIGHT_URL configured, skipping Flight client initialization");
    }
}
