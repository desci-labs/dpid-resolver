import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dpidEnv = process.env.DPID_ENV;

Sentry.init({
    dsn: "https://1f6d6a75201b566c085580cbb700ef69@o1330109.ingest.us.sentry.io/4510267031355392",
    environment: dpidEnv,
    tracesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
    profilesSampleRate: 0.1,
    profileLifecycle: "trace",
});
