import { t, type Key, type Lang } from "@/lib/i18n";
import type { DisputeType, FactCheck, FactSource, FactStatus } from "@/lib/types";
import styles from "./FactCheckList.module.css";
import vstyles from "./verdict/verdict.module.css";

const STATUS_KEY = {
  supported: "factcheck.status.supported",
  refuted: "factcheck.status.refuted",
  mixed: "factcheck.status.mixed",
  unverified: "factcheck.status.unverified",
} as const satisfies Record<FactStatus, Key>;

/** Most sources shown per claim (the server already caps it; this is a
 * second guard for stored or hand-made rows). */
const MAX_SOURCES = 3;

/** A source link we are willing to render: http(s) only, shown by its
 * domain. Anything else (javascript:, data:, relative, garbage) is dropped. */
export function safeSource(url: string): { href: string; domain: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { href: u.href, domain: u.hostname.replace(/^www\./i, "") };
  } catch {
    return null;
  }
}

type ShownSource = { title: string; href: string; domain: string };

function shownSources(sources: FactSource[]): ShownSource[] {
  const out: ShownSource[] = [];
  for (const s of sources) {
    const safe = safeSource(s.url);
    if (!safe || out.some((o) => o.href === safe.href)) continue;
    out.push({ title: s.title.trim() || safe.domain, ...safe });
    if (out.length === MAX_SOURCES) break;
  }
  return out;
}

/** Status shape next to the word, so the chip never relies on colour. */
function StatusGlyph({ status }: { status: FactStatus }) {
  const line = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 12 12" aria-hidden className={styles.glyph}>
      {status === "supported" ? <path d="M2.5 6.3 5 8.6 9.6 3.6" {...line} /> : null}
      {status === "refuted" ? <path d="M3.3 3.3l5.4 5.4M8.7 3.3 3.3 8.7" {...line} /> : null}
      {status === "mixed" ? <path d="M2.8 6h6.4" {...line} /> : null}
      {status === "unverified" ? (
        <>
          <path d="M4.4 4.4a1.7 1.7 0 1 1 2.4 1.5c-.5.3-.8.6-.8 1.2" {...line} />
          <circle cx="6" cy="9.2" r=".8" fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}

/** The muted line when nothing was looked up. A factual or mixed dispute
 * turns on facts only the people involved know (who paid, what was said),
 * so "values or meanings, not facts" would contradict its badge. */
export function noneKey(disputeType: DisputeType | undefined): Key {
  return disputeType === "factual" || disputeType === "mixed" ? "factcheck.noneFactual" : "factcheck.none";
}

/**
 * The premium web fact-check, below the verdict card and before the facts
 * the verdict leans on. "checked" lists each claim with a status chip and up
 * to three source links (domain shown, full title for screen readers);
 * "none" and "unavailable" are one muted line, the "none" line worded for
 * the dispute type. Hook-free (share page SSR).
 */
export function FactCheckList({
  factCheck,
  lang,
  disputeType,
}: {
  factCheck: FactCheck;
  lang: Lang;
  disputeType?: DisputeType;
}) {
  const claims = factCheck.status === "checked" ? factCheck.claims : [];
  return (
    <section className={styles.root}>
      <h3 className={vstyles.sectionTitle}>{t(lang, "factcheck.title")}</h3>
      {claims.length === 0 ? (
        <p className={styles.muted}>
          {t(lang, factCheck.status === "unavailable" ? "factcheck.unavailable" : noneKey(disputeType))}
        </p>
      ) : (
        <>
          <p className={styles.lead}>{t(lang, "factcheck.lead")}</p>
          <ol className={styles.list}>
            {claims.map((c, i) => {
              const sources = shownSources(c.sources);
              return (
                <li key={i} className={styles.claim}>
                  <span className={styles.chip} data-status={c.status}>
                    <StatusGlyph status={c.status} />
                    {t(lang, STATUS_KEY[c.status])}
                  </span>
                  <p className={styles.claimText}>{c.claim}</p>
                  {c.summary ? <p className={styles.summary}>{c.summary}</p> : null}
                  {sources.length > 0 ? (
                    <div className={styles.sources}>
                      <span className={styles.sourcesLabel}>{t(lang, "factcheck.sources")}</span>
                      <ul className={styles.sourceList}>
                        {sources.map((s) => (
                          <li key={s.href}>
                            <a
                              href={s.href}
                              target="_blank"
                              rel="noopener noreferrer nofollow ugc"
                              className={styles.source}
                            >
                              {s.domain}
                              <span className="sr-only">
                                {" "}
                                {t(lang, "factcheck.sourceAria", { title: s.title })}
                              </span>
                              <svg viewBox="0 0 10 10" aria-hidden className={styles.out}>
                                <path
                                  d="M4 2h4v4M8 2 3 7"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth={1.4}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
