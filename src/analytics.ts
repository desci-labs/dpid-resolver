import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import parentLogger from "./logger.js";
const logger = parentLogger.child({ module: "analytics" });

export enum LogEventType {
    DPID_GET = 0,
    DPID_LIST = 1,
}

export interface LogRequest {
    dpid: number;
    version: number;
    extra: unknown;
    eventType: LogEventType;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
let supabase: SupabaseClient<any, "public", any> | undefined;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    logger.info("Created analytics client");
} else {
    logger.error("Failed to create analytics client, check .env file");
}

export default {
    log: async ({ dpid, version, extra, eventType }: LogRequest) => {
        logger.info({ supabase: !!supabase, dpid, version, extra, eventType }, "log analytics");
        if (supabase) {
            const { data, error } = await supabase
                .from("dpid_usage")
                .insert([{ dpid, version, extra, event_type: eventType }]);

            logger.info({ data, error });
        }
    },
};
