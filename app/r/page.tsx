import type { Metadata } from "next";
import { PendingInviteScreen } from "@/components/case/RespondScreen";

/** Where sign-in sends the invited person back to: the invite token is kept
 * in their browser, so it never rides along in a sign-in e-mail or an OAuth
 * state. Never indexed. */
export const metadata: Metadata = {
  title: "Your invite",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function PendingInvitePage() {
  return <PendingInviteScreen />;
}
