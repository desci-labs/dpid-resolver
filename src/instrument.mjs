import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dpidEnv = process.env.DPID_ENV;

// Ensure to call this before importing any other modules!
Sentry.init({
    dsn: "https://1f6d6a75201b566c085580cbb700ef69@o1330109.ingest.us.sentry.io/4510267031355392",
    environment: dpidEnv,
    // Add Tracing by setting tracesSampleRate
    // We recommend adjusting this value in production
    tracesSampleRate: 1.0,
    integrations: [nodeProfilingIntegration()],
    // Set sampling rate for profiling - this is evaluated only once per SDK.init call
    profileSessionSampleRate: 1.0,
    // Trace lifecycle automatically enables profiling during active traces
    profileLifecycle: "trace",

    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
});
