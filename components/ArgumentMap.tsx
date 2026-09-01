import type { ArgumentMap as ArgumentMapData, ClaimKind } from "@/lib/types";
import { KIND_KEY, t, type Lang } from "@/lib/i18n";

const KIND_VAR: Record<ClaimKind, string> = {
  fact: "--kind-fact",
  value: "--kind-value",
  definition: "--kind-definition",
  logic: "--kind-logic",
};

function KindTag({ kind, lang }: { kind: ClaimKind; lang: Lang }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: "var(--ink-2)" }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: `var(${KIND_VAR[kind]})`,
          display: "inline-block",
        }}
      />
      {t(lang, KIND_KEY[kind])}
    </span>
  );
}

function ClaimColumn({
  party,
  name,
  claims,
  bedrock,
  color,
  soft,
  lang,
}: {
  party: "a" | "b";
  name: string;
  claims: { claim: string; kind: ClaimKind }[];
  bedrock: string;
  color: string;
  soft: string;
  lang: Lang;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-1.5"
        style={{ background: soft }}
      >
        <span
          className="flex items-center justify-center text-[11px] font-bold text-white rounded-full shrink-0"
          style={{ background: color, width: 20, height: 20 }}
        >
          {party.toUpperCase()}
        </span>
        <span className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>
          {name}
        </span>
      </div>

      {claims.map((c, i) => (
        <div
          key={i}
          className="rounded-lg px-3 py-2 flex flex-col gap-1"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--ring)",
            borderLeft: `3px solid ${color}`,
          }}
        >
          <span className="text-sm leading-snug" style={{ color: "var(--ink)" }}>
            {c.claim}
          </span>
          <KindTag kind={c.kind} lang={lang} />
        </div>
      ))}

      {/* connector down to bedrock */}
      <div className="flex justify-center" aria-hidden>
        <span style={{ color: "var(--muted)" }}>↓</span>
      </div>

      <div
        className="rounded-xl px-3 py-2 text-center"
        style={{
          background: "var(--surface)",
          border: `2px solid ${color}`,
        }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wide mb-0.5"
          style={{ color: "var(--muted)" }}
        >
          {t(lang, "bedrock")}
        </div>
        <div className="text-sm font-medium leading-snug" style={{ color: "var(--ink)" }}>
          {bedrock}
        </div>
      </div>
    </div>
  );
}

/**
 * The whole argument at a glance: each side's claims descending to its
 * bedrock premise, with the crux — what the fight is REALLY about — beneath.
 */
export function ArgumentMap({
  map,
  crux,
  nameA,
  nameB,
  lang = "en",
}: {
  map: ArgumentMapData;
  crux: string;
  nameA: string;
  nameB: string;
  lang?: Lang;
}) {
  return (
    <section className="rise-in">
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: "var(--muted)" }}
      >
        {t(lang, "mapTitle")}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <ClaimColumn
          party="a"
          name={nameA}
          claims={map.side_a}
          bedrock={map.bedrock_a}
          color="var(--party-a)"
          soft="var(--party-a-soft)"
          lang={lang}
        />
        <ClaimColumn
          party="b"
          name={nameB}
          claims={map.side_b}
          bedrock={map.bedrock_b}
          color="var(--party-b)"
          soft="var(--party-b-soft)"
          lang={lang}
        />
      </div>

      {/* converging connectors into the crux */}
      <div className="flex justify-center gap-16 my-1" aria-hidden>
        <span style={{ color: "var(--muted)" }}>↘</span>
        <span style={{ color: "var(--muted)" }}>↙</span>
      </div>

      <div
        className="rounded-xl px-4 py-3 text-center"
        style={{
          background: "var(--surface)",
          border: "2px dashed var(--muted)",
        }}
      >
        <div
          className="text-[10px] font-semibold uppercase tracking-wide mb-1"
          style={{ color: "var(--muted)" }}
        >
          {t(lang, "cruxTitle")}
        </div>
        <p className="text-sm font-medium leading-snug" style={{ color: "var(--ink)" }}>
          {crux}
        </p>
      </div>
    </section>
  );
}
