import type { Metadata } from "next";
import { RespondScreen } from "@/components/case/RespondScreen";

/** The invited person's page. The token in the URL is the only key to the
 * case, so the page is never indexed and sends no Referer anywhere. */
export const metadata: Metadata = {
  title: "Tell your side",
  description: "Someone asked Settle to settle an argument with you. Tell your side.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RespondPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  return <RespondScreen token={token} />;
}
