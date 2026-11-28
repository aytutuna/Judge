import type { Metadata } from "next";
import { ParentLinkScreen } from "@/components/ParentLinkScreen";

/** The page behind a parent's link. The token in the URL is the only key,
 * so the page is never indexed and sends no Referer anywhere. */
export const metadata: Metadata = {
  title: "A parent's yes",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ParentPage({ params, searchParams }: PageProps<"/parent/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  return <ParentLinkScreen token={token} declineFirst={query.decline === "1"} />;
}
