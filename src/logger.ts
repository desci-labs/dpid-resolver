import { pino } from "pino";
import dotenv from "dotenv";
dotenv.config();
const logLevel = process.env.PINO_LOG_LEVEL || "trace";

const devTransport = {
    target: "pino-pretty",
    level: logLevel,
    options: {
        colorize: true,
    },
};

const logger = pino({
    level: logLevel,
    serializers: {
        files: omitBuffer,
    },
    transport: process.env.NODE_ENV === "production" ? undefined : { targets: [devTransport] },
    redact: {
        paths: [
            "req.headers.cookie",
            "req.headers.authorization",
            "email",
            "*.email",
            "authorization",
            "*.authorization",
        ],
    },
});

export default logger;

/* eslint-disable @typescript-eslint/no-explicit-any */
function omitBuffer(array: any) {
    return array.map((obj: any) => {
        const { ...rest } = obj;
        return rest;
    });
}

export const serializeError = (e: Error) => pino.stdSerializers.err(e);

process.on("uncaughtException", (err) => {
    logger.fatal(err, "uncaught exception");
});
