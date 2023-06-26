import dotenv from "dotenv";
dotenv.config();
import { SupabaseClient, createClient } from "@supabase/supabase-js";
import parentLogger from "logger";
const logger = parentLogger.child({ module: "analytics" });

export enum LogEventType {
    DPID_GET = 0,
    DPID_LIST = 1,
}

export interface LogRequest {
    dpid: number;
    version: number;
    extra: any;
    eventType: LogEventType;
}

let supabase: SupabaseClient<any, "public", any> | undefined;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    logger.info("Created analytics client");
} else {
    logger.error(process.env, "Failed to create analytics client, env");
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
