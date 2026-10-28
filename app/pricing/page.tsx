import type { Metadata } from "next";
import { PricingView } from "@/components/account/PricingView";
import { SITE_NAME, SITE_OG_IMAGE } from "../site";

const title = "Judge pricing";
const description =
  "Your first Judge verdict is free. After that, credit packs or a monthly plan, every verdict with facts checked on the web and clarifying questions.";

export const metadata: Metadata = {
  title: "Pricing",
  description,
  alternates: { canonical: "/pricing" },
  // See app/about/page.tsx: page-level openGraph drops the layout's image.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title,
    description,
    url: "/pricing",
    images: SITE_OG_IMAGE,
  },
  twitter: { card: "summary_large_image", title, description, images: SITE_OG_IMAGE },
};

export default function PricingPage() {
  return <PricingView />;
}
