import { errWithCause } from "pino-std-serializers";
import parentLogger from "./logger.js";

const logger = parentLogger.child({
    module: "process.ts",
});

export const setupProcessHandlers = () => {
    process.on("uncaughtException", (error) => {
        logger.fatal(errWithCause(error), "exiting on uncaught exception");
        process.exit(1);
    });

    process.on("exit", (code) => {
        logger.info({ code }, "process exiting");
    });
};
