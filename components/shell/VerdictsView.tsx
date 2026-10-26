"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { useViewer } from "@/lib/use-viewer";
import { accountEntry } from "../AccountMenu";
import { PageShell } from "../account/PageShell";
import { HistoryList } from "./HistoryList";
import { useHistory } from "./useHistory";

/** /verdicts: the account's verdicts and cases, or signed out this
 * browser's own list with a way to sign in. */
export function VerdictsView() {
  const lang = useLang();
  const viewer = useViewer();
  const history = useHistory(viewer);
  const [now] = useState(Date.now);
  return (
    <PageShell lang={lang} kicker={t(lang, "shell.history")} title={t(lang, "nav.verdicts")}>
      <HistoryList
        lang={lang}
        history={history}
        now={now}
        signIn={accountEntry(viewer.config, viewer.me) === "signin"}
        onLoadMore={history.loadMore}
      />
    </PageShell>
  );
}
