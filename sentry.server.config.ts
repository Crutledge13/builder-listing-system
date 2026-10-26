// Sentry on the server: error alerts for pages, server actions and API routes.
// Does nothing until NEXT_PUBLIC_SENTRY_DSN is set (see .env.example).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? "development",
  // Errors only for now; no performance tracing or session recordings.
  tracesSampleRate: 0,
  // Never send who was signed in, cookies, headers, form contents (logins,
  // listing data) or query strings. Errors and where they happened only.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    genAI: { inputs: false, outputs: false },
  },
});
