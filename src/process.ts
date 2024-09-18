import parentLogger from "./logger.js";

const logger = parentLogger.child({
    module: "process.ts",
});

process.on("uncaughtException", (error) => {
    logger.fatal({ error }, "exiting on uncaught exception");
    process.exit(1);
});

process.on("exit", (code) => {
    logger.info({ code }, "process exiting");
});
