import type { Metadata } from "next";
import { InfoPage } from "@/components/InfoPage";
import { contactEmail, SITE_NAME, SITE_OG_IMAGE } from "../site";

const title = "Verdict privacy";
const description =
  "What Verdict stores (the anonymized argument and verdict, for share links), what it doesn't, and who else handles your text.";

export const metadata: Metadata = {
  title: "Privacy",
  description,
  alternates: { canonical: "/privacy" },
  // See app/about/page.tsx: page-level openGraph drops the layout's image.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title,
    description,
    url: "/privacy",
    images: SITE_OG_IMAGE,
  },
  twitter: { card: "summary_large_image", title, description, images: SITE_OG_IMAGE },
};

export default function PrivacyPage() {
  return <InfoPage page="privacy" contactEmail={contactEmail()} />;
}
