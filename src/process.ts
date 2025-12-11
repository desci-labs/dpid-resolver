import { errWithCause } from "pino-std-serializers";
import * as Sentry from "@sentry/node";
import parentLogger from "./logger.js";

const logger = parentLogger.child({
    module: "process.ts",
});

export const setupProcessHandlers = () => {
    process.on("uncaughtException", (error) => {
        logger.fatal(errWithCause(error), "exiting on uncaught exception");
        Sentry.captureException(error, { tags: { fatal: true, type: "uncaughtException" } });
        process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
        logger.fatal({ reason, promise }, "exiting on unhandled promise rejection");
        Sentry.captureException(reason, { tags: { fatal: true, type: "unhandledRejection" } });
        process.exit(1);
    });

    process.on("exit", (code) => {
        logger.info({ code }, "process exiting");
    });
};
