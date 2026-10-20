import type { Metadata } from "next";
import { PricingView } from "@/components/account/PricingView";
import { SITE_NAME, SITE_OG_IMAGE } from "../site";

const title = "Judge pricing";
const description =
  "Judge is free. Premium adds facts checked on the web with sources, a stronger judge panel and clarifying questions, as credit packs or a monthly plan.";

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
