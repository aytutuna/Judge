import type { NextConfig } from "next";
import { PHASE_PRODUCTION_SERVER } from "next/constants";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    // Always inlined, even when unset, so the build drops the browser SDK
    // when there is no DSN.
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? "",
  },
};

export default async function config(phase: string): Promise<NextConfig> {
  // next start only serves what the build made; loading the Sentry build
  // plugin there would cost about 30 MB and 0.4 s for nothing.
  if (phase === PHASE_PRODUCTION_SERVER) return nextConfig;

  const { withSentryConfig } = await import("@sentry/nextjs/config");
  const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env;
  const uploadSourceMaps = Boolean(SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT);

  // Without the upload settings no browser source maps are built at all. With
  // them, the maps are uploaded and then deleted from .next/static, so they
  // are never served.
  const wrapped = withSentryConfig(nextConfig, {
    authToken: SENTRY_AUTH_TOKEN,
    org: SENTRY_ORG,
    project: SENTRY_PROJECT,
    silent: !uploadSourceMaps,
    telemetry: false,
    sourcemaps: { disable: !uploadSourceMaps, deleteSourcemapsAfterUpload: true },
    release: { name: process.env.SENTRY_RELEASE, create: uploadSourceMaps },
    bundleSizeOptimizations: { excludeTracing: true, excludeDebugStatements: true },
    suppressOnRouterTransitionStartWarning: true,
    // Orchestrion patches server dependencies (the AI SDK among them) at
    // build time for instrumentation nothing here uses.
    buildTimeInstrumentation: false,
  });
  // withSentryConfig always asks Next for sentry-trace and baggage meta tags
  // on every page; they only serve tracing.
  delete wrapped.experimental?.clientTraceMetadata;
  return wrapped;
}
