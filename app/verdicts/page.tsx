import type { Metadata } from "next";
import { VerdictsView } from "@/components/shell/VerdictsView";

export const metadata: Metadata = {
  title: "My verdicts",
  description: "The verdicts and cases you started on Judge.",
  robots: { index: false, follow: false },
};

export default function VerdictsPage() {
  return <VerdictsView />;
}
