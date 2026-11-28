import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig(),
  // Turbopack puts each language into the server output several times.
  buildCommand: "next build --webpack",
};
