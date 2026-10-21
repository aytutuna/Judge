"use client";

import { useEffect, useId, useRef, useState } from "react";
import { apiErrorMessage, t, type Lang } from "@/lib/i18n";
import { localizeLabels, resolveParties } from "@/lib/names";
import { otherLabels, type DisplayResponse, type DisplayState } from "@/lib/originals-types";
import type { NameMapping } from "@/lib/types";
import { ownerHeaders } from "@/lib/owner-store";
import account from "./account/AccountPages.module.css";

/** What the writer's views need to edit a verdict's share-page names. */
export type OwnerShare = {
  verdictId: string;
  /** The owner token, or null when the session is the credential. */
  token: string | null;
  display: DisplayState;
  /** Prefill for the writer's own name (account first name), if any. */
  suggestedA: string | null;
  /** Party A is the writer (a first-person narrator): its field is "Your name". */
  aIsWriter: boolean;
  /** "Person C".."Person Z" labels this verdict uses. */
  otherLabels: string[];
  /** The writer saved these names before (on any device): no prompt before a share. */
  namesConfirmed: boolean;
  onSaved: (display: DisplayState) => void;
};

/** The owner context for a verdict, from the writer's name map. `lang` is
 * the language the verdict was judged in (narrator detection). */
export function buildOwnerShare(args: {
  verdictId: string;
  token: string | null;
  display: DisplayState;
  suggestedA: string | null;
  nameMap: NameMapping[];
  lang: Lang;
  namesConfirmed?: boolean;
  onSaved: (display: DisplayState) => void;
}): OwnerShare {
  const parties = resolveParties(args.nameMap, args.lang, "A");
  return {
    verdictId: args.verdictId,
    token: args.token,
    display: args.display,
    suggestedA: args.suggestedA,
    aIsWriter: Boolean(parties.get("A")?.self),
    otherLabels: otherLabels(args.nameMap, args.display),
    namesConfirmed: args.namesConfirmed ?? false,
    onSaved: args.onSaved,
  };
}

/**
 * The names a share page shows: the writer's own name, the other people's
 * names (prefilled with their first names) and a switch for names on the
 * shared page at all. Empty fields show the label. Plain labels, no notice
 * text. `onDone` runs after a successful save (e.g. the share it was opened
 * for).
 */
export function ShareDialog({
  open,
  lang,
  owner,
  saveLabel,
  onClose,
  onDone,
}: {
  open: boolean;
  lang: Lang;
  owner: OwnerShare;
  saveLabel: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [others, setOthers] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const d = owner.display;
      // The form is reset from the latest names each time it opens.
      setA(d.a ?? (owner.aIsWriter ? owner.suggestedA : null) ?? "");
      setB(d.b ?? "");
      setOthers(Object.fromEntries(owner.otherLabels.map((l) => [l, d.others[l] ?? ""])));
      setVisible(d.namesVisible);
      setError(null);
      dialog.showModal();
      firstRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, owner]);

  async function save() {
    setSaving(true);
    setError(null);
    const clean = (v: string) => (v.trim() ? v.trim() : null);
    const body = {
      namesVisible: visible,
      a: clean(a),
      b: clean(b),
      others: Object.fromEntries(Object.entries(others).map(([k, v]) => [k, clean(v)])),
    };
    try {
      const res = await fetch(`/api/v1/verdicts/${encodeURIComponent(owner.verdictId)}/display`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...ownerHeaders(owner.token) },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (json as { code?: unknown } | null)?.code;
        setError(code === "invalid" ? t(lang, "names.invalid") : apiErrorMessage(lang, json, res.status));
        return;
      }
      owner.onSaved((json as DisplayResponse).display);
      onClose();
      onDone?.();
    } catch {
      setError(t(lang, "names.failed"));
    } finally {
      setSaving(false);
    }
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, first = false) => (
    <label key={id} className={account.field}>
      <span className={account.label}>{label}</span>
      <input
        ref={first ? firstRef : undefined}
        className={account.input}
        value={value}
        maxLength={40}
        autoComplete="off"
        disabled={!visible || saving}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <dialog ref={ref} className={account.dialog} aria-labelledby={titleId} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id={titleId} className={account.dialogTitle}>
          {t(lang, "names.title")}
        </h2>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={visible} disabled={saving} onChange={(e) => setVisible(e.target.checked)} />
          <span>{t(lang, "names.show")}</span>
        </label>
        {field("a", t(lang, owner.aIsWriter ? "names.you" : "party.a"), a, setA, true)}
        {field("b", t(lang, "party.b"), b, setB)}
        {owner.otherLabels.map((label) =>
          field(label, localizeLabels(label, lang), others[label] ?? "", (v) => setOthers((o) => ({ ...o, [label]: v }))),
        )}
        {error ? (
          <p className={account.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={account.row}>
          <button type="submit" className={`${account.btn} ${account.primary}`} disabled={saving}>
            {saveLabel}
          </button>
          <button type="button" className={`${account.btn} ${account.secondary}`} onClick={onClose}>
            {t(lang, "case.cancel")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
