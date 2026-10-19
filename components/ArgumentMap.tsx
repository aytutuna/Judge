import type { ArgumentMap as ArgumentMapData, ClaimKind } from "@/lib/types";
import { KIND_KEY, t, type Lang } from "@/lib/i18n";
import { PALETTE } from "@/lib/palette";
import { stripLeadingEmoji } from "@/lib/text";
import { CruxBlock } from "./verdict/CruxBlock";
import styles from "./verdict/verdict.module.css";

/** Ink shape per claim kind, the same shapes as the 3D claim pieces:
 * cube = fact, circle = value, triangle = definition, diamond = logic.
 * Shape plus the written kind, so nothing is coded by colour alone. */
function KindGlyph({ kind }: { kind: ClaimKind }) {
  const ink = PALETTE.ink;
  switch (kind) {
    case "fact":
      return (
        <svg viewBox="0 0 12 12" className={styles.glyph} aria-hidden>
          <path d="M6 .8 11 3.6v4.8L6 11.2 1 8.4V3.6z" fill={ink} />
          <path
            d="M6 6v5.2M6 6 1 3.6M6 6l5-2.4"
            fill="none"
            stroke={PALETTE.paper}
            strokeWidth={0.9}
            strokeLinejoin="round"
          />
        </svg>
      );
    case "value":
      return (
        <svg viewBox="0 0 12 12" className={styles.glyph} aria-hidden>
          <circle cx={6} cy={6} r={5} fill={ink} />
        </svg>
      );
    case "definition":
      return (
        <svg viewBox="0 0 12 12" className={styles.glyph} aria-hidden>
          <path d="M6 1.2 11.2 10.6H.8z" fill={ink} />
        </svg>
      );
    case "logic":
      return (
        <svg viewBox="0 0 12 12" className={styles.glyph} aria-hidden>
          <path d="M6 .8 11.2 6 6 11.2.8 6z" fill={ink} />
        </svg>
      );
  }
}

function KindTag({ kind, lang }: { kind: ClaimKind; lang: Lang }) {
  return (
    <span className={styles.kind}>
      <KindGlyph kind={kind} />
      {t(lang, KIND_KEY[kind])}
    </span>
  );
}

function ClaimColumn({
  party,
  name,
  claims,
  bedrock,
  lang,
}: {
  party: "a" | "b";
  name: string;
  claims: { claim: string; kind: ClaimKind }[];
  bedrock: string;
  lang: Lang;
}) {
  const a = party === "a";
  return (
    <div className={styles.col}>
      <div className={`${styles.colHead} ${a ? styles.colHeadA : styles.colHeadB}`}>
        <span
          aria-hidden
          className={`${styles.partyChip} ${a ? styles.partyChipA : styles.partyChipB}`}
        >
          {party.toUpperCase()}
        </span>
        <span className={styles.colName}>{name}</span>
      </div>

      {claims.map((c, i) => (
        <div key={i} className={`${styles.claim} ${a ? styles.claimA : styles.claimB}`}>
          <span className={styles.claimText}>{c.claim}</span>
          <KindTag kind={c.kind} lang={lang} />
        </div>
      ))}

      <span className={styles.connector} aria-hidden />

      <div className={styles.bedrock}>
        <span className={styles.k}>{stripLeadingEmoji(t(lang, "bedrock"))}</span>
        <div className={styles.bedrockText}>{bedrock}</div>
      </div>
    </div>
  );
}

/**
 * The whole argument at a glance: each side's claims descending to its
 * bedrock premise, with the crux (what the fight is REALLY about) beneath.
 * `showCrux={false}` when the crux is already on the verdict card above.
 */
export function ArgumentMap({
  map,
  crux,
  nameA,
  nameB,
  lang = "en",
  showCrux = true,
}: {
  map: ArgumentMapData;
  crux: string;
  nameA: string;
  nameB: string;
  lang?: Lang;
  showCrux?: boolean;
}) {
  return (
    <section>
      <h3 className={styles.sectionTitle}>{t(lang, "mapTitle")}</h3>
      <div className={styles.mapCols}>
        <ClaimColumn
          party="a"
          name={nameA}
          claims={map.side_a}
          bedrock={map.bedrock_a}
          lang={lang}
        />
        <ClaimColumn
          party="b"
          name={nameB}
          claims={map.side_b}
          bedrock={map.bedrock_b}
          lang={lang}
        />
      </div>

      {showCrux ? (
        <>
          <div className={styles.mapJoin} aria-hidden>
            <span />
            <span />
          </div>
          <CruxBlock title={stripLeadingEmoji(t(lang, "cruxTitle"))} text={crux} />
        </>
      ) : null}
    </section>
  );
}
