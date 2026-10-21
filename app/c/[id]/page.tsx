import type { Metadata } from "next";
import { CaseScreen } from "@/components/case/CaseScreen";

/** The owner's private case page: never indexed, and the invite link it
 * shows never leaks through a Referer header. */
export const metadata: Metadata = {
  title: "Your case",
  description: "A two-sided Judge case: the invite, its status and the verdict.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function CasePage({ params }: PageProps<"/c/[id]">) {
  const { id } = await params;
  return <CaseScreen id={id} />;
}
