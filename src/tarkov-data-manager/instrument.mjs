// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  release: `tarkov-data-manager@${process.env.DEPLOY_REF || 'local'}`,
  environment: process.env.SENTRY_ENV || 'unknown',
  dsn: process.env.SENTRY_DSN || 'https://d96804f089a6d7e9d7abf051b37aab48@sentry.thaddeus.io/3',
  integrations: [
    nodeProfilingIntegration(),
    Sentry.requestDataIntegration({
      include: {
        ip: true
      }
    }),
  ],
  // Performance Monitoring
  tracesSampleRate: process.env.SENTRY_TRACE_RATE || 1,

  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: process.env.SENTRY_PROFILE_RATE || 1,
});