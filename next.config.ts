import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Ship the demo videos with the media route that streams them.
  outputFileTracingIncludes: {
    "/api/media/*": ["./demo-media/**/*"],
    "/s/*": ["./demo-media/**/*"],
  },
  // Realtor share pages: never in search engines, and the link's code is never
  // passed on to other sites (e.g. when someone clicks a tour link).
  async headers() {
    return [
      {
        source: "/s/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Sentry: readable error locations need SENTRY_AUTH_TOKEN, SENTRY_ORG and
// SENTRY_PROJECT in Vercel; without them the build still works, just without
// uploading source maps.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  telemetry: false,
});
