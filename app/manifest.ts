import type { MetadataRoute } from "next";
import { PALETTE } from "@/lib/palette";
import { SITE_DESCRIPTION, SITE_NAME } from "./site";

/** The maskable icons carry the mark at its unscaled size: at 110% its outer
 * edge reaches past the 80% safe circle a circular mask keeps. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: PALETTE.ivory,
    theme_color: PALETTE.ivory,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
