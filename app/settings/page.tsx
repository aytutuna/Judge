import type { Metadata } from "next";
import { SettingsView } from "@/components/account/SettingsView";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your Judge account, language and appearance.",
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return <SettingsView />;
}
