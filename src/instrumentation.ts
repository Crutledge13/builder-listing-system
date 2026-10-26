// Runs once when the server starts: turns on Sentry error alerts.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("../sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("../sentry.edge.config");
}

// Errors thrown while rendering pages or running server actions.
export const onRequestError = Sentry.captureRequestError;
