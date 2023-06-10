import pino from "pino";
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

const fileTransport = {
    target: "pino/file",
    options: { destination: `${__dirname}/../log/server.log` },
    level: "trace",
};

const logger = pino({
    level: logLevel,
    serializers: {
        files: omitBuffer,
    },
    transport:
        process.env.NODE_ENV === "production"
            ? undefined
            : {
                targets: [devTransport, fileTransport],
            },
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

function omitBuffer(array: any) {
    return array.map((obj: any) => {
        const { buffer, ...rest } = obj;
        return rest;
    });
}

process.on("uncaughtException", (err) => {
    logger.fatal(err, "uncaught exception");
});
