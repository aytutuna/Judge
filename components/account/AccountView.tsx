"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Entitlement } from "@/lib/account-types";
import { t, tWithDate, type Lang } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import { markSignedOut, useViewer, type ViewerState } from "@/lib/use-viewer";
import { CaseList, useCaseList, type CaseListState } from "../case/CaseList";
import { PremiumSpark } from "../PremiumBadge";
import styles from "./AccountPages.module.css";
import { PageShell } from "./PageShell";

/** How long the "account deleted" note stays before going home. */
const DELETED_HOLD_MS = 1800;

/** Premium while anything premium is held: credits or a live subscription
 * (even one at its fair-use cap). */
export function planOf(e: Entitlement | null | undefined): "free" | "premium" {
  return e && (e.credits > 0 || e.subscription !== null) ? "premium" : "free";
}

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

export type AccountPanelProps = {
  lang: Lang;
  viewer: ViewerState;
  deleting: boolean;
  deleted: boolean;
  deleteError: string | null;
  onSignOut: () => void;
  onDelete: () => void;
  /** "Your cases", when this deployment offers two-sided cases. */
  cases?: CaseListState | null;
};

/** Everything on /account below the title, stateless apart from the
 * confirm dialog, so tests can render each state from a mocked /me. */
export function AccountPanel({
  lang,
  viewer,
  deleting,
  deleted,
  deleteError,
  onSignOut,
  onDelete,
  cases = null,
}: AccountPanelProps) {
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

  const user = viewer.me.user;
  if (!user) {
    return (
      <div className={styles.card}>
        <p className={styles.muted}>{t(lang, "account.signInPrompt")}</p>
        <Link href="/signin?next=%2Faccount" className={`${styles.btn} ${styles.primary}`}>
          {t(lang, "nav.signIn")}
        </Link>
      </div>
    );
  }

  const e = viewer.me.entitlement;
  const plan = planOf(e);
  const sub = e?.subscription ?? null;

  return (
    <>
      <section className={styles.card} aria-labelledby="account-plan">
        <p className={styles.muted}>{t(lang, "account.signedInAs", { email: user.email })}</p>
        <h2 id="account-plan" className="sr-only">
          {t(lang, "account.plan")}
        </h2>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{t(lang, "account.plan")}</dt>
            <dd>
              {plan === "premium" ? (
                <span className={styles.planPremium}>
                  <PremiumSpark />
                  {t(lang, "account.plan.premium")}
                </span>
              ) : (
                t(lang, "account.plan.free")
              )}
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>{t(lang, "account.credits")}</dt>
            <dd>{e?.credits ?? 0}</dd>
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
          <p className={styles.small}>{tWithDate(lang, "tier.fairUse", e.resetsAt)}</p>
        ) : null}
        <div className={styles.row}>
          <Link href="/pricing" className={`${styles.btn} ${styles.primary}`}>
            {t(lang, plan === "premium" ? "nav.pricing" : "account.getPremium")}
          </Link>
          <button type="button" className={`${styles.btn} ${styles.secondary}`} onClick={onSignOut}>
            {t(lang, "account.signOut")}
          </button>
        </div>
      </section>

      {cases ? <CaseList lang={lang} state={cases} /> : null}

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

/** /account: plan, credits and monthly allowance, sign out, delete. */
export function AccountView() {
  const lang = useLang();
  const router = useRouter();
  const viewer = useViewer();
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const casesOn = Boolean(viewer.config?.features?.cases && viewer.me?.user);
  const cases = useCaseList(casesOn);

  useEffect(() => {
    if (!deleted) return;
    const id = setTimeout(() => router.replace("/"), DELETED_HOLD_MS);
    return () => clearTimeout(id);
  }, [deleted, router]);

  async function signOut() {
    try {
      const { signOut: run } = await import("@/lib/auth-client");
      await run();
    } finally {
      markSignedOut();
    }
  }

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
    <PageShell lang={lang} kicker={t(lang, "nav.account")} title={t(lang, "account.title")}>
      <AccountPanel
        lang={lang}
        viewer={viewer}
        deleting={deleting}
        deleted={deleted}
        deleteError={deleteError}
        onSignOut={() => void signOut()}
        onDelete={() => void remove()}
        cases={casesOn ? cases : null}
      />
    </PageShell>
  );
}
