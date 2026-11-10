import type { Metadata } from "next";
import { AccountDetailView } from "@/components/account/AccountDetailView";

export const metadata: Metadata = {
  title: "Account",
  description: "Your Judge account.",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountDetailView />;
}
