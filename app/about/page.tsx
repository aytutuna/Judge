import type { Metadata } from "next";
import { InfoPage } from "@/components/InfoPage";
import { SITE_NAME, SITE_OG_IMAGE } from "../site";

const title = "About Judge";
const description =
  "What Judge is, how it judges an argument (steelman, crux, three independent judges, cross-examination) and where its limits are.";

export const metadata: Metadata = {
  title: "About",
  description,
  alternates: { canonical: "/about" },
  // A page-level openGraph replaces the layout's, image included, so the
  // shared card is restated here; twitter likewise needs its own title.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title,
    description,
    url: "/about",
    images: SITE_OG_IMAGE,
  },
  twitter: { card: "summary_large_image", title, description, images: SITE_OG_IMAGE },
};

export default function AboutPage() {
  return <InfoPage page="about" />;
}
