"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiErrorMessage, t, type Lang } from "@/lib/i18n";
import type { MineResponse, OriginalPayload, OriginalStatus, RemovalResponse } from "@/lib/originals-types";
import { forgetOwnerToken, ownerHeaders } from "@/lib/owner-store";
import { openConfirm } from "./account/AccountView";
import account from "./account/AccountPages.module.css";
import caseStyles from "./case/case.module.css";
import { ShareDialog, type OwnerShare } from "./ShareDialog";
import { markVerdictRemoved } from "./shell/useHistory";

/**
 * The writer's own view of a verdict: GET /api/v1/verdicts/{id}/mine with
 * the owner token kept in this browser, or the session. Null while loading,
 * for anyone else (404), and on errors: the public view stays.
 */
export function useMine(id: string, token: string | null | undefined, signedIn: boolean | null): MineResponse | null {
  const [mine, setMine] = useState<MineResponse | null>(null);
  useEffect(() => {
    if (token === undefined || signedIn === null) return;
    if (!token && !signedIn) return;
    const ctrl = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(id)}/mine`, {
          cache: "no-store",
          signal: ctrl.signal,
          headers: { Accept: "application/json", ...ownerHeaders(token) },
        });
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as MineResponse | null;
        if (!ctrl.signal.aborted && json?.id === id) setMine(json);
      } catch {
        // Offline or aborted: the public view stays.
      }
    })();
    return () => ctrl.abort();
  }, [id, token, signedIn]);
  return mine;
}

/** "What you wrote": the text exactly as written, Premium's questions and
 * answers, and the text read from screenshots. */
export function OriginalDisclosure({
  lang,
  title,
  status,
  original,
}: {
  lang: Lang;
  title: string;
  status: OriginalStatus;
  original: OriginalPayload | null;
}) {
  if (status === "removed") return null;
  return (
    <details className={caseStyles.transcript}>
      <summary>{title}</summary>
      {original ? (
        <div className="flex flex-col gap-3">
          <p className="whitespace-pre-wrap break-words">{original.text}</p>
          <OriginalExtras lang={lang} original={original} />
        </div>
      ) : (
        <p className={account.muted}>{t(lang, status === "unreadable" ? "owner.unreadable" : "owner.notStored")}</p>
      )}
    </details>
  );
}

function OriginalExtras({ lang, original }: { lang: Lang; original: OriginalPayload }) {
  return (
    <>
      {original.clarifications?.length ? (
        <>
          <p className={caseStyles.fieldLabel}>{t(lang, "owner.answers")}</p>
          <ul className="flex flex-col gap-2">
            {original.clarifications.map((c, i) => (
              <li key={i}>
                <strong>{c.question}</strong>
                <br />
                {c.answer.trim() ? c.answer : t(lang, "owner.skipped")}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {original.evidence?.length ? (
        <>
          <p className={caseStyles.fieldLabel}>{t(lang, "owner.evidence")}</p>
          {original.evidence.map((ev, i) => (
            <pre key={i}>{ev.transcript}</pre>
          ))}
        </>
      ) : null}
    </>
  );
}

/**
 * Below the writer's verdict: their answers and screenshots, the names
 * editor, removal (with a confirm that says what happens) and, for a
 * token-owned verdict seen while signed in, keeping it in the account. Case verdicts point to
 * the case page (the owner) or the invite link (Party B), where their names
 * and removal live.
 */
export function OwnerPanel({
  lang,
  mine,
  token,
  owner,
  signedIn,
  onRemoved,
}: {
  lang: Lang;
  mine: MineResponse;
  token: string | null;
  owner: OwnerShare | null;
  signedIn: boolean;
  onRemoved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);
  const removeRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (mine.case) {
    // Party B's page is the invite link they answered (/r/<token>), which
    // this page does not know: they get a line pointing there instead.
    if (mine.case.party === "b") {
      return (
        <div className={caseStyles.stack}>
          <p className={caseStyles.note}>{t(lang, "owner.caseRespondent")}</p>
        </div>
      );
    }
    return (
      <div className={caseStyles.stack}>
        <p className={caseStyles.note}>{t(lang, "owner.case")}</p>
        <Link href={`/c/${encodeURIComponent(mine.case.id)}`} className={`${account.btn} ${account.secondary}`}>
          {t(lang, "owner.caseLink")}
        </Link>
      </div>
    );
  }

  async function post(path: string, body: unknown): Promise<unknown | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(mine.id)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ownerHeaders(token) },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(lang, json, res.status));
        return null;
      }
      return json;
    } catch {
      setError(t(lang, "verdict.removeFailed"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const json = (await post("removal", { confirm: "remove" })) as RemovalResponse | null;
    if (json?.removed) {
      forgetOwnerToken(mine.id);
      markVerdictRemoved(mine.id);
      onRemoved();
    }
  }

  async function claim() {
    const json = (await post("claim", {})) as { claimed?: boolean } | null;
    if (json?.claimed) {
      setClaimed(true);
      setNote(t(lang, "owner.claimed"));
    }
  }

  // The text itself is the thread's first turn; only what came with it is here.
  const original = mine.originalStatus === "stored" ? mine.original : null;
  const extras = original?.clarifications?.length || original?.evidence?.length ? original : null;

  return (
    <div className={caseStyles.stack}>
      {extras ? (
        <details className={caseStyles.transcript}>
          <summary>{t(lang, "owner.extras")}</summary>
          <div className="flex flex-col gap-3">
            <OriginalExtras lang={lang} original={extras} />
          </div>
        </details>
      ) : null}
      {note ? (
        <p className={caseStyles.calm} role="status">
          {note}
        </p>
      ) : null}
      {error ? (
        <p className={caseStyles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={caseStyles.row}>
        {owner && mine.originalStatus === "stored" ? (
          <button type="button" className={`${account.btn} ${account.secondary}`} disabled={busy} onClick={() => setEditing(true)}>
            {t(lang, "names.edit")}
          </button>
        ) : null}
        {mine.via === "token" && signedIn && !claimed ? (
          <button type="button" className={`${account.btn} ${account.secondary}`} disabled={busy} onClick={() => void claim()}>
            {t(lang, "owner.claim")}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className={`${caseStyles.textBtn} ${caseStyles.dangerText}`}
        disabled={busy}
        onClick={() => openConfirm(removeRef.current, cancelRef.current)}
      >
        {t(lang, "verdict.remove")}
      </button>
      {owner ? (
        <ShareDialog
          open={editing}
          lang={lang}
          owner={owner}
          saveLabel={t(lang, "names.save")}
          onClose={() => setEditing(false)}
          onDone={() => setNote(t(lang, "names.saved"))}
        />
      ) : null}
      <dialog ref={removeRef} className={account.dialog} aria-labelledby="remove-verdict-title">
        <h2 id="remove-verdict-title" className={account.dialogTitle}>
          {t(lang, "verdict.remove")}
        </h2>
        <p className={account.dialogText}>{t(lang, "verdict.remove.confirm")}</p>
        <div className={account.row}>
          <button
            type="button"
            className={`${account.btn} ${account.danger}`}
            onClick={() => {
              removeRef.current?.close();
              void remove();
            }}
          >
            {t(lang, "verdict.remove.yes")}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className={`${account.btn} ${account.secondary}`}
            onClick={() => removeRef.current?.close()}
          >
            {t(lang, "case.cancel")}
          </button>
        </div>
      </dialog>
    </div>
  );
}
