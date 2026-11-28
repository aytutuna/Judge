"use client";

import { useEffect, useState } from "react";
import type { ParentLink } from "@/lib/account-types";
import { apiErrorMessage, t, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import styles from "./account/AccountPages.module.css";
import { PageShell } from "./account/PageShell";

type Loaded = ParentLink | "gone" | "unavailable" | null;
type Done = "approved" | "declined" | "withdrawn";

const RULES = ["parent.rule1", "parent.rule2", "parent.rule3", "parent.rule4"] as const;

export type ParentLinkBodyProps = {
  lang: Lang;
  link: ParentLink;
  guardian: boolean;
  busy: boolean;
  error: string | null;
  done: Done | null;
  /** The decline link of the email: Decline is the first button. */
  declineFirst: boolean;
  onGuardian: (v: boolean) => void;
  onDecide: (action: "approve" | "decline" | "withdraw") => void;
};

/** What a parent sees behind a link of the request or withdraw mail,
 * stateless so tests can render each state. */
export function ParentLinkBody({ lang, link, guardian, busy, error, done, declineFirst, onGuardian, onDecide }: ParentLinkBodyProps) {
  const name = link.name.trim() || t(lang, "parent.someone");
  if (done) {
    return (
      <p className={styles.dialogText} role="status">
        {t(lang, done === "approved" ? "parent.approvedDone" : done === "declined" ? "parent.declinedDone" : "parent.withdrawnDone", { name })}
      </p>
    );
  }
  const problem = error ? (
    <p className={styles.error} role="alert">
      {error}
    </p>
  ) : null;
  if (link.kind === "withdraw") {
    return (
      <>
        <h1 className={styles.h1}>{t(lang, "parent.withdrawTitle", { name })}</h1>
        <p className={styles.lead}>{t(lang, "parent.withdrawLead")}</p>
        {problem}
        <div className={styles.row}>
          <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={busy} onClick={() => onDecide("withdraw")}>
            {t(lang, "parent.withdraw")}
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      <h1 className={styles.h1}>{t(lang, "parent.title", { name })}</h1>
      <p className={styles.lead}>{t(lang, "parent.lead", { name })}</p>
      <p className={styles.dialogText}>{t(lang, "parent.what")}</p>
      <p className={styles.dialogText}>{t(lang, "parent.rulesTitle")}</p>
      <ul className={styles.features}>
        {RULES.map((key) => (
          <li key={key}>{t(lang, key)}</li>
        ))}
      </ul>
      <label className={styles.check}>
        <input type="checkbox" checked={guardian} onChange={(e) => onGuardian(e.target.checked)} />
        {t(lang, "parent.tick", { name })}
      </label>
      {problem}
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.btn} ${declineFirst ? styles.secondary : styles.primary}`}
          disabled={busy || !guardian}
          onClick={() => onDecide("approve")}
        >
          {t(lang, "parent.approve")}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${declineFirst ? styles.primary : styles.secondary}`}
          disabled={busy}
          autoFocus={declineFirst}
          onClick={() => onDecide("decline")}
        >
          {t(lang, "parent.decline")}
        </button>
      </div>
    </>
  );
}

/** /parent/<token>: a parent approves or declines, or withdraws, with no account. */
export function ParentLinkScreen({ token, declineFirst }: { token: string; declineFirst: boolean }) {
  const lang = useLang();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [guardian, setGuardian] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let live = true;
    void import("@/lib/auth-client").then(async ({ fetchParentLink }) => {
      const res = await fetchParentLink(token);
      if (live) setLoaded(res === null ? "gone" : res);
    });
    return () => {
      live = false;
    };
  }, [token]);

  async function decide(action: "approve" | "decline" | "withdraw") {
    setBusy(true);
    setError(null);
    try {
      const { decideParentLink } = await import("@/lib/auth-client");
      const res = await decideParentLink(token, action, guardian);
      if (res.ok) setDone(res.result as Done);
      else setError(apiErrorMessage(lang, res.body, res.status));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (loaded === null) body = null;
  else if (loaded === "gone" || (loaded !== "unavailable" && !loaded.usable)) {
    body = <p className={styles.dialogText}>{t(lang, "error.parent_link")}</p>;
  } else if (loaded === "unavailable") {
    body = <p className={styles.dialogText}>{t(lang, "errorFallback")}</p>;
  } else {
    body = (
      <ParentLinkBody
        lang={lang}
        link={loaded}
        guardian={guardian}
        busy={busy}
        error={error}
        done={done}
        declineFirst={declineFirst}
        onGuardian={setGuardian}
        onDecide={(a) => void decide(a)}
      />
    );
  }
  return (
    <PageShell lang={lang} bare>
      {body}
    </PageShell>
  );
}
