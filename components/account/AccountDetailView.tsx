"use client";

import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { AccountDetailSection } from "./AccountView";
import { PageShell } from "./PageShell";

/** /settings/account: opened from the account row in Settings. */
export function AccountDetailView() {
  const lang = useLang();
  return (
    <PageShell lang={lang} title={t(lang, "account.title")}>
      <AccountDetailSection />
    </PageShell>
  );
}
