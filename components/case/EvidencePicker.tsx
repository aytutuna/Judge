"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { track } from "@/lib/analytics/client";
import type { EvidenceStatus, EvidenceUploadResponse } from "@/lib/case-types";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/case-types";
import { apiErrorMessage, t, type Key, type Lang } from "@/lib/i18n";
import { prepareImage } from "@/lib/image-downscale";
import styles from "./case.module.css";

/**
 * Screenshot evidence: pick up to `max` images, each is downscaled in the
 * browser and uploaded right away (POST /api/v1/evidence, or the
 * respondent's /api/v1/respond/{token}/evidence), so reading overlaps with
 * writing. The server answers per image with a signed token and a preview of
 * what it read; only the tokens are sent with the submission. The preview is
 * the raw transcript (it may contain names) and is shown to the uploader
 * only. Images are never kept: not here, not on the server.
 */

export type EvidenceItemStatus = "reading" | EvidenceStatus;

export type EvidenceItem = {
  id: string;
  /** Position label shown to the user, 1-based, stable while the item lives. */
  n: number;
  name: string;
  /** Object URL of the (downscaled) image, for the thumbnail. */
  thumb: string | null;
  status: EvidenceItemStatus;
  token: string | null;
  preview: string | null;
};

export type UploadFailure = { body: unknown; status: number | null };

export type EvidenceController = {
  items: EvidenceItem[];
  /** Tokens of the images read successfully, in order. */
  tokens: string[];
  /** Images still being read: a submission waits for them. */
  busy: boolean;
  /** Whether more images can be added. */
  full: boolean;
  /** The last whole-request failure, if any. */
  failure: UploadFailure | null;
  /** True right after the user picked more images than fit. */
  overLimit: boolean;
  add: (files: readonly File[]) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const STATUS_KEY = {
  ok: "evidence.ok",
  reading: "evidence.reading",
  unreadable: "evidence.status.unreadable",
  refused: "evidence.status.refused",
  unsupported: "evidence.status.unsupported",
  too_large: "evidence.status.too_large",
  failed: "evidence.status.failed",
} as const satisfies Record<EvidenceItemStatus, Key>;

export function evidenceStatusText(lang: Lang, status: EvidenceItemStatus): string {
  return t(lang, STATUS_KEY[status]);
}

/** Maps one upload response onto the items that were sent, by index. */
export function applyUploadResult(
  items: readonly EvidenceItem[],
  sentIds: readonly string[],
  response: EvidenceUploadResponse | null,
): EvidenceItem[] {
  return items.map((item) => {
    const index = sentIds.indexOf(item.id);
    if (index < 0) return item;
    const result = response?.items.find((r) => r.index === index);
    if (!result) return { ...item, status: "failed" };
    if (result.status === "ok" && result.token) {
      return { ...item, status: "ok", token: result.token, preview: result.preview };
    }
    return { ...item, status: result.status === "ok" ? "failed" : result.status, token: null, preview: null };
  });
}

let seq = 0;
const nextId = () => `ev${(seq += 1)}`;

export function useEvidence(endpoint: string, max: number): EvidenceController {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [failure, setFailure] = useState<UploadFailure | null>(null);
  const [overLimit, setOverLimit] = useState(false);
  const urls = useRef(new Set<string>());
  const counter = useRef(0);

  useEffect(() => {
    const held = urls.current;
    return () => {
      for (const u of held) URL.revokeObjectURL(u);
      held.clear();
    };
  }, []);

  const release = useCallback((url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    urls.current.delete(url);
  }, []);

  const add = useCallback(
    (files: readonly File[]) => {
      setFailure(null);
      const room = Math.max(0, max - items.length);
      setOverLimit(files.length > room);
      const picked = files.slice(0, room);
      if (picked.length === 0) return;
      const fresh: EvidenceItem[] = picked.map((f) => ({
        id: nextId(),
        n: (counter.current += 1),
        name: f.name || "image",
        thumb: null,
        status: "reading",
        token: null,
        preview: null,
      }));
      setItems((prev) => [...prev, ...fresh]);

      void (async () => {
        const prepared = await Promise.all(picked.map((f) => prepareImage(f).catch(() => null)));
        const send: { id: string; blob: Blob }[] = [];
        const thumbs = new Map<string, string>();
        prepared.forEach((blob, i) => {
          const id = fresh[i].id;
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          urls.current.add(url);
          thumbs.set(id, url);
          send.push({ id, blob });
        });
        setItems((prev) =>
          prev.map((it) => {
            if (!fresh.some((f) => f.id === it.id)) return it;
            const thumb = thumbs.get(it.id) ?? null;
            return thumb ? { ...it, thumb } : { ...it, status: "unsupported" };
          }),
        );
        if (send.length === 0) return;

        const form = new FormData();
        send.forEach((s, i) => {
          const ext = s.blob.type === "image/png" ? "png" : s.blob.type === "image/gif" ? "gif" : "jpg";
          form.append("image", s.blob, `image-${i + 1}.${ext}`);
        });
        const sentIds = send.map((s) => s.id);
        let response: EvidenceUploadResponse | null = null;
        try {
          const res = await fetch(endpoint, { method: "POST", body: form });
          const json: unknown = await res.json().catch(() => null);
          if (res.ok && json && Array.isArray((json as EvidenceUploadResponse).items)) {
            response = json as EvidenceUploadResponse;
            track("evidence_added");
          } else {
            setFailure({ body: json, status: res.status });
          }
        } catch {
          setFailure({ body: null, status: null });
        }
        setItems((prev) => applyUploadResult(prev, sentIds, response));
      })();
    },
    [endpoint, items.length, max],
  );

  const remove = useCallback(
    (id: string) => {
      setOverLimit(false);
      setItems((prev) => {
        const gone = prev.find((it) => it.id === id);
        if (gone) release(gone.thumb);
        return prev.filter((it) => it.id !== id);
      });
    },
    [release],
  );

  const clear = useCallback(() => {
    setItems((prev) => {
      for (const it of prev) release(it.thumb);
      return [];
    });
    setFailure(null);
    setOverLimit(false);
  }, [release]);

  return {
    items,
    tokens: items.filter((it) => it.status === "ok" && it.token).map((it) => it.token as string),
    busy: items.some((it) => it.status === "reading"),
    full: items.length >= max,
    failure,
    overLimit,
    add,
    remove,
    clear,
  };
}

function ImageGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7.2" cy="8" r="1.6" fill="currentColor" />
      <path d="m3.5 14.5 4.2-4 3 2.6 2.4-2 3.4 3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Presentational picker. Stateless apart from the hidden file input, so
 * tests render every state from plain items. */
export function EvidencePicker({
  lang,
  max,
  items,
  full,
  failure,
  overLimit,
  disabled = false,
  onAdd,
  onRemove,
}: {
  lang: Lang;
  max: number;
  items: readonly EvidenceItem[];
  full: boolean;
  failure: UploadFailure | null;
  overLimit: boolean;
  disabled?: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const hintId = useId();
  const single = max === 1;
  const announce = items.map((it) => `${t(lang, "evidence.thumb", { n: it.n })}: ${evidenceStatusText(lang, it.status)}`).join(". ");

  return (
    <div className={styles.evidence} role="group" aria-labelledby={labelId} aria-describedby={hintId}>
      <p className={styles.evidenceHead}>
        <span id={labelId}>{t(lang, "evidence.label")}</span>
        <span className={styles.count} aria-hidden>
          {items.length} / {max}
        </span>
      </p>

      {items.length > 0 ? (
        <ul className={styles.chipsList}>
          {items.map((it) => {
            const tone = it.status === "ok" ? "ok" : it.status === "reading" ? undefined : "bad";
            return (
              <li key={it.id} className={styles.evItem} data-status={it.status}>
                {it.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local object URL, never optimizable
                  <img className={styles.evThumb} src={it.thumb} alt={t(lang, "evidence.thumb", { n: it.n })} />
                ) : (
                  <span className={`${styles.evThumb} ${styles.evThumbEmpty}`} aria-hidden>
                    <ImageGlyph />
                  </span>
                )}
                <span className={styles.evMeta}>
                  <span className={styles.evName}>{t(lang, "evidence.thumb", { n: it.n })}</span>
                  <span className={styles.evStatus} data-tone={tone}>
                    {it.status === "reading" ? <span className={styles.spinner} aria-hidden /> : null}
                    {evidenceStatusText(lang, it.status)}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.evRemove}
                  aria-label={t(lang, "evidence.remove", { n: it.n })}
                  onClick={() => onRemove(it.id)}
                  disabled={disabled}
                >
                  <svg viewBox="0 0 14 14" aria-hidden>
                    <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
                {it.status === "ok" && it.preview ? (
                  <details className={styles.evPreview}>
                    <summary>{t(lang, "evidence.preview")}</summary>
                    <p>{t(lang, "evidence.previewNote")}</p>
                    <pre>{it.preview}</pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <button
        type="button"
        className={styles.evAdd}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || full}
      >
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        {t(lang, single ? "evidence.addOne" : "evidence.add")}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple={!single}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          if (files.length) onAdd(files);
        }}
      />
      <p className={styles.evHint} id={hintId}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect x="3" y="7" width="10" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span>{single ? t(lang, "evidence.hintOne") : t(lang, "evidence.hint", { n: max })}</span>
      </p>
      {overLimit ? <p className={styles.note}>{t(lang, "evidence.limit")}</p> : null}
      {failure ? (
        <p className={styles.error} role="alert">
          {apiErrorMessage(lang, failure.body, failure.status ?? undefined)}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
