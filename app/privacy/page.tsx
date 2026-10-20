import type { Metadata } from "next";
import { InfoPage } from "@/components/InfoPage";
import { contactEmail, SITE_NAME, SITE_OG_IMAGE } from "../site";

const title = "Judge privacy";
const description =
  "What Judge stores (your text as you wrote it, encrypted, and the anonymized version the judges read), who can see what, how removal works, where your data is processed, how long it is kept, and your rights.";

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
