import type { ArgumentMap as ArgumentMapData, ClaimKind } from "@/lib/types";

const KIND_META: Record<ClaimKind, { label: string; varName: string }> = {
  fact: { label: "fact", varName: "--kind-fact" },
  value: { label: "value", varName: "--kind-value" },
  definition: { label: "definition", varName: "--kind-definition" },
  logic: { label: "logic", varName: "--kind-logic" },
};

function KindTag({ kind }: { kind: ClaimKind }) {
  const meta = KIND_META[kind];
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
          background: `var(${meta.varName})`,
          display: "inline-block",
        }}
      />
      {meta.label}
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
}: {
  party: "a" | "b";
  name: string;
  claims: { claim: string; kind: ClaimKind }[];
  bedrock: string;
  color: string;
  soft: string;
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
          <KindTag kind={c.kind} />
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
          🪨 Bedrock
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
}: {
  map: ArgumentMapData;
  crux: string;
  nameA: string;
  nameB: string;
}) {
  return (
    <section className="rise-in">
      <h3
        className="text-xs font-semibold uppercase tracking-wide mb-2"
        style={{ color: "var(--muted)" }}
      >
        The argument, mapped to bedrock
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <ClaimColumn
          party="a"
          name={nameA}
          claims={map.side_a}
          bedrock={map.bedrock_a}
          color="var(--party-a)"
          soft="var(--party-a-soft)"
        />
        <ClaimColumn
          party="b"
          name={nameB}
          claims={map.side_b}
          bedrock={map.bedrock_b}
          color="var(--party-b)"
          soft="var(--party-b-soft)"
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
          ⚡ The crux — what this is really about
        </div>
        <p className="text-sm font-medium leading-snug" style={{ color: "var(--ink)" }}>
          {crux}
        </p>
      </div>
    </section>
  );
}
