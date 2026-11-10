"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { t, tWithDate, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { langTag } from "@/lib/langs";
import { markSignedOut, useViewer, type ViewerState } from "@/lib/use-viewer";
import styles from "./AccountPages.module.css";

/** How long the "account deleted" note stays before going home. */
const DELETED_HOLD_MS = 1800;

/** Opens the delete confirmation with focus on the safe choice. showModal()
 * would otherwise focus the first button, "Yes, delete it", and `autoFocus`
 * does not help on a client-rendered dialog. */
export function openConfirm(
  dialog: Pick<HTMLDialogElement, "showModal"> | null,
  safe: Pick<HTMLButtonElement, "focus"> | null,
): void {
  if (!dialog) return;
  dialog.showModal();
  safe?.focus();
}

const OUT = "M7 17 17 7M8 7h9v9";

/** What stands in for the account until there is a signed-in viewer to show:
 * the loading, failed and signed-out cards. Null once there is one. */
function noAccount(lang: Lang, viewer: ViewerState, next: string) {
  if (viewer.status === "idle" || viewer.status === "loading") {
    return (
      <div className={styles.card}>
        <p className={styles.muted} role="status">
          {t(lang, "account.loading")}
        </p>
      </div>
    );
  }
  if (viewer.status === "error" || !viewer.me) {
    return (
      <div className={styles.card}>
        <p className={styles.error} role="alert">
          {t(lang, "account.loadFailed")}
        </p>
      </div>
    );
  }
  if (!viewer.me.user) {
    return (
      <div className={styles.card}>
        <p className={styles.muted}>{t(lang, "account.signInPrompt")}</p>
        <Link href={`/signin?next=${encodeURIComponent(next)}`} className={`${styles.btn} ${styles.primary}`}>
          {t(lang, "nav.signIn")}
        </Link>
      </div>
    );
  }
  return null;
}

/** The Settings account section: who is signed in (a row that opens the
 * account page), credits, plan and Pricing. Stateless, so tests can render
 * each state from a mocked /me. */
export function AccountPanel({ lang, viewer }: { lang: Lang; viewer: ViewerState }) {
  const missing = noAccount(lang, viewer, "/settings");
  if (missing) return missing;
  const user = viewer.me?.user;
  if (!user) return null;

  const e = viewer.me?.entitlement;
  const sub = e?.subscription ?? null;

  return (
    <>
      <section className={styles.card} aria-labelledby="account-plan">
        <Link href="/settings/account" className={styles.option}>
          <span>{t(lang, "account.signedInAs", { email: user.email })}</span>
          <svg viewBox="0 0 24 24" aria-hidden className={styles.out}>
            <path d={OUT} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <h2 id="account-plan" className="sr-only">
          {t(lang, "account.plan")}
        </h2>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{t(lang, "account.credits")}</dt>
            <dd>{(e?.credits ?? 0).toLocaleString(langTag(lang))}</dd>
          </div>
          <div className={styles.fact}>
            <dt>{t(lang, "account.subscription")}</dt>
            <dd>
              {sub ? (
                <>
                  <span>
                    {tWithDate(
                      lang,
                      sub.willRenew ? "account.subscriptionRenews" : "account.subscriptionUntil",
                      sub.periodEnd,
                    )}
                  </span>
                  <span className={styles.factSub}>
                    {t(lang, "account.fairUse", { used: sub.used, cap: sub.cap })}
                  </span>
                </>
              ) : (
                t(lang, "account.subscriptionNone")
              )}
            </dd>
          </div>
        </dl>
        {e?.blockedReason === "fair_use" ? (
          <p className={styles.small}>{tWithDate(lang, "error.fair_use", e.resetsAt)}</p>
        ) : null}
        <div className={styles.row}>
          <Link href="/pricing" className={`${styles.btn} ${styles.primary}`}>
            {t(lang, e?.canUsePremium ? "nav.pricing" : "account.getPremium")}
          </Link>
        </div>
      </section>
    </>
  );
}

export type AccountDetailProps = {
  lang: Lang;
  viewer: ViewerState;
  deleting: boolean;
  deleted: boolean;
  deleteError: string | null;
  onDelete: () => void;
};

/** /settings/account: the email and deleting the account. */
export function AccountDetailPanel({ lang, viewer, deleting, deleted, deleteError, onDelete }: AccountDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (deleted) {
    return (
      <div className={styles.card}>
        <p className={styles.ok} role="status">
          {t(lang, "account.deleted")}
        </p>
      </div>
    );
  }
  const missing = noAccount(lang, viewer, "/settings/account");
  if (missing) return missing;
  const user = viewer.me?.user;
  if (!user) return null;

  return (
    <>
      <section className={styles.card}>
        <p className={styles.muted}>{t(lang, "account.signedInAs", { email: user.email })}</p>
      </section>

      <section className={styles.card}>
        {deleteError ? (
          <p className={styles.error} role="alert">
            {deleteError}
          </p>
        ) : null}
        <button
          type="button"
          className={`${styles.btn} ${styles.danger}`}
          disabled={deleting}
          onClick={() => openConfirm(dialogRef.current, cancelRef.current)}
        >
          {t(lang, "account.delete")}
        </button>
      </section>

      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="delete-title">
        <h2 id="delete-title" className={styles.dialogTitle}>
          {t(lang, "account.delete")}
        </h2>
        <p className={styles.dialogText}>{t(lang, "account.deleteConfirm")}</p>
        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.btn} ${styles.danger}`}
            disabled={deleting}
            onClick={() => {
              dialogRef.current?.close();
              onDelete();
            }}
          >
            {t(lang, "account.deleteYes")}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className={`${styles.btn} ${styles.secondary}`}
            onClick={() => dialogRef.current?.close()}
          >
            {t(lang, "account.deleteCancel")}
          </button>
        </div>
      </dialog>
    </>
  );
}

/** Plan, credits and monthly allowance: the Settings page's account section. */
export function AccountSection() {
  return <AccountPanel lang={useLang()} viewer={useViewer()} />;
}

/** Sign out, the last row of Settings; nothing while signed out. */
export function SignOutRow() {
  const lang = useLang();
  const viewer = useViewer();
  if (!viewer.me?.user) return null;

  async function signOut() {
    try {
      const { signOut: run } = await import("@/lib/auth-client");
      await run();
    } finally {
      markSignedOut();
    }
  }

  return (
    <section className={styles.card}>
      <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={() => void signOut()}>
        {t(lang, "account.signOut")}
      </button>
    </section>
  );
}

/** The account page's own state: the delete request and what follows it. */
export function AccountDetailSection() {
  const lang = useLang();
  const router = useRouter();
  const viewer = useViewer();
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!deleted) return;
    const id = setTimeout(() => router.replace("/"), DELETED_HOLD_MS);
    return () => clearTimeout(id);
  }, [deleted, router]);

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    const { deleteAccount } = await import("@/lib/auth-client");
    const res = await deleteAccount();
    setDeleting(false);
    if (res.ok) {
      setDeleted(true);
      markSignedOut();
      return;
    }
    // Signed out meanwhile: the panel itself switches to the sign-in prompt.
    if (res.code === "signin_required") markSignedOut();
    else setDeleteError(t(lang, "account.deleteFailed"));
  }

  return (
    <AccountDetailPanel
      lang={lang}
      viewer={viewer}
      deleting={deleting}
      deleted={deleted}
      deleteError={deleteError}
      onDelete={() => void remove()}
    />
  );
}
