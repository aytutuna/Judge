import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Prerendered pages are read from the assets bundle; nothing is revalidated.
export default {
  ...defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache }),
  // Turbopack puts each language into the server output several times.
  buildCommand: "next build --webpack",
};
