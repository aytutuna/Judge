import type { Metadata } from "next";
import { InfoPage } from "@/components/InfoPage";
import { contactEmail, SITE_NAME, SITE_OG_IMAGE } from "../site";

const title = "Judge terms of use";
const description =
  "Who can use Judge (18 and older), what a verdict is and isn't, your content, purchases and renewals through the App Store or Google Play, fair use, and how to reach us.";

export const metadata: Metadata = {
  title: "Terms of Use",
  description,
  alternates: { canonical: "/terms" },
  // See app/about/page.tsx: page-level openGraph drops the layout's image.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title,
    description,
    url: "/terms",
    images: SITE_OG_IMAGE,
  },
  twitter: { card: "summary_large_image", title, description, images: SITE_OG_IMAGE },
};

export default function TermsPage() {
  return <InfoPage page="terms" contactEmail={contactEmail()} />;
}
