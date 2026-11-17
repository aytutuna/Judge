import type { Metadata } from "next";
import { DeleteAccountPage } from "@/components/DeleteAccountPage";
import { contactEmail, SITE_NAME, SITE_OG_IMAGE } from "../site";

const title = "Delete your Judge account";
const description = "How to delete your Judge account and its data in the app or on the website, what is deleted and what is kept.";

export const metadata: Metadata = {
  title: "Delete account",
  description,
  alternates: { canonical: "/delete-account" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title,
    description,
    url: "/delete-account",
    images: SITE_OG_IMAGE,
  },
  twitter: { card: "summary_large_image", title, description, images: SITE_OG_IMAGE },
};

export default function DeleteAccountRoute() {
  return <DeleteAccountPage contactEmail={contactEmail()} />;
}
