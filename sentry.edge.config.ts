// Sentry for code that runs on Vercel's edge (if any). Same settings as the server.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.VERCEL_ENV ?? "development",
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
