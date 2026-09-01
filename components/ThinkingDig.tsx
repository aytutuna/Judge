"use client";

import {
  type CSSProperties,
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react";
import type { ClaimKind } from "../lib/types";
import { KIND_KEY, t, type Key, type Lang } from "../lib/i18n";
import { useLang } from "../lib/lang";
import {
  FINISH_CAPTION,
  INITIAL_STATE,
  LABEL_STEP,
  READY,
  ROWS,
  STILL_JUDGING,
  THINKING_STEPS,
  announcement,
  caption,
  firstSide,
  kindsFor,
  plan,
  popPlan,
  sceneFlags,
  type DigState,
} from "../lib/thinking";

/**
 * lib/thinking.ts's exported English strings → dictionary keys, so
 * captions/announcements localize by REVERSE LOOKUP while thinking.ts keeps
 * making every timing/announcement decision (its semantics — the story once
 * on cycle 0, STILL_JUDGING on later cycles, READY when done — are preserved
 * by construction). Exported for the completeness test.
 */
export const KEY_BY_CAPTION: Record<string, Key> = {
  [THINKING_STEPS[0].caption]: "thinking.read",
  [THINKING_STEPS[1].caption]: "thinking.label",
  [THINKING_STEPS[2].caption]: "thinking.dig", // steps 3–4 share this caption — same entry, harmless
  [THINKING_STEPS[5].caption]: "thinking.reach",
  [THINKING_STEPS[6].caption]: "thinking.crux",
  [THINKING_STEPS[7].caption]: "thinking.judges",
  [THINKING_STEPS[8].caption]: "thinking.votes",
  [FINISH_CAPTION]: "thinking.finish",
  [STILL_JUDGING]: "thinking.stillJudging",
  [READY]: "thinking.ready",
};

/* ---------- reduced motion (module-scope external store) ---------- */

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function getSnapshot(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_QUERY).matches;
}
function getServerSnapshot(): boolean {
  return false;
}

/* ---------- scene constants ---------- */

type Side = "a" | "b";
const SIDES: readonly Side[] = ["a", "b"];
const PARTY = {
  a: { color: "var(--party-a)", soft: "var(--party-a-soft)", labelKey: "party.a" },
  b: { color: "var(--party-b)", soft: "var(--party-b-soft)", labelKey: "party.b" },
} as const satisfies Record<Side, { color: string; soft: string; labelKey: Key }>;
/** Horizontal nudge per sky row so a column reads as scattered clouds. */
const ROW_OFFSETS = [0, 16, 6];
/** Bore segment heights: strata band 1, band 2, gap into the bedrock card. */
const SEGMENT_HEIGHTS = [10, 10, 6];
const SIDE_STAGGER_MS = 120;

const KIND_VAR: Record<ClaimKind, string> = {
  fact: "--kind-fact",
  value: "--kind-value",
  definition: "--kind-definition",
  logic: "--kind-logic",
};

function KindTag({
  kind,
  lang,
  className,
  style,
}: {
  kind: ClaimKind;
  lang: Lang;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={["inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide", className]
        .filter(Boolean)
        .join(" ")}
      style={{ color: "var(--ink-2)", ...style }}
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

/** Pop delay for one side's cloud (and its bore segment): side stagger only in loop-mode pops. */
function sidePopDelay(row: number, side: Side, state: DigState): { delayMs: number; fast: boolean } | null {
  const p = popPlan(row, state);
  if (!p) return null;
  const stagger = p.fast || firstSide(row, state.cycle) === side ? 0 : SIDE_STAGGER_MS;
  return { delayMs: p.delayMs + stagger, fast: p.fast };
}

/* ---------- component ---------- */

export function ThinkingDig({ done, onFinished }: { done: boolean; onFinished: () => void }) {
  const lang = useLang();
  const reduced = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [state, setState] = useState<DigState>(INITIAL_STATE);
  const finish = useEffectEvent(onFinished);

  useEffect(() => {
    const skip = reduced || document.hidden;
    const { to, delayMs } = plan(state, done, skip);
    const t = setTimeout(() => (to === "finish" ? finish() : setState(to)), delayMs);
    return () => clearTimeout(t);
  }, [state, done, reduced]);

  const flags = sceneFlags(state);
  const kinds = kindsFor(state.cycle);
  const finishMode = state.mode === "finish";
  // Tags that start appearing in finish mode (never shown in loop) appear together.
  const tagsStartInFinish = finishMode && state.from < LABEL_STEP;
  const cruxDelay = flags.fastCrux ? "0.25s" : "0.4s";
  const rows = Array.from({ length: ROWS }, (_, i) => i);

  return (
    <div className="flex flex-col items-center gap-1.5 w-full py-2">
      <p
        className="text-xs font-semibold uppercase tracking-wide text-center"
        style={{ color: "var(--muted)" }}
      >
        {t(lang, "thinking.eyebrow")}
      </p>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {t(lang, KEY_BY_CAPTION[announcement(state, done)])}
      </p>
      <p
        className="text-sm font-medium text-center"
        aria-hidden
        style={{ color: "var(--ink-2)" }}
      >
        {t(lang, KEY_BY_CAPTION[caption(state)])}
      </p>

      <div
        key={state.cycle}
        aria-hidden
        className={["dig-scene w-full pointer-events-none select-none", flags.fadeOut ? "dig-out" : ""]
          .filter(Boolean)
          .join(" ")}
      >
        {/* column headers, like ArgumentMap */}
        <div className="grid grid-cols-2 gap-3">
          {SIDES.map((side) => (
            <div
              key={side}
              className="flex items-center gap-2 rounded-lg px-3 py-1"
              style={{ background: PARTY[side].soft }}
            >
              <span
                className="flex items-center justify-center text-[11px] font-bold text-white rounded-full shrink-0"
                style={{ background: PARTY[side].color, width: 20, height: 20 }}
              >
                {side.toUpperCase()}
              </span>
              <span className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>
                {t(lang, PARTY[side].labelKey)}
              </span>
            </div>
          ))}
        </div>

        {/* sky: three cloud rows per column */}
        <div className="grid grid-cols-2 gap-3 mt-1.5">
          {SIDES.map((side) => (
            <div key={side} className="flex flex-col gap-1">
              {rows.map((row) => {
                const pop = sidePopDelay(row, side, state);
                const nudge = ROW_OFFSETS[row] * 2;
                return (
                  <div
                    key={row}
                    className="flex justify-center h-6"
                    style={side === "a" ? { paddingLeft: nudge } : { paddingRight: nudge }}
                  >
                    <span
                      className={[
                        "rounded-full h-6 px-2 inline-flex items-center gap-1",
                        pop ? "dig-cloud dig-cloud-pop" : "dig-cloud",
                      ].join(" ")}
                      style={{
                        background: PARTY[side].soft,
                        border: "1px solid var(--ring)",
                        ...(pop
                          ? {
                              animationDelay: `${pop.delayMs}ms`,
                              animationDuration: pop.fast ? "0.4s" : "0.5s",
                            }
                          : {
                              // cloud-in delay, then the bob's per-row phase offset
                              animationDelay: `${row * 120}ms, ${400 + row * 120 + row * 450}ms`,
                            }),
                      }}
                    >
                      <KindTag
                        kind={kinds[side][row]}
                        lang={lang}
                        className={flags.tagsOn ? "tag-in" : undefined}
                        style={
                          flags.tagsOn
                            ? { animationDelay: `${tagsStartInFinish ? 0 : row * 100}ms` }
                            : { opacity: 0 }
                        }
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ground line, two strata bands, and the bore per column */}
        <div className="relative mt-1.5" style={{ height: 28 }}>
          <div style={{ height: 2, background: "var(--line)" }} />
          <div style={{ height: 10, background: "var(--soil-1)" }} />
          <div style={{ height: 10, background: "var(--soil-2)" }} />
          <div className="absolute inset-x-0 grid grid-cols-2 gap-3" style={{ top: 2, bottom: 0 }}>
            {SIDES.map((side) => (
              <div key={side} className="flex justify-center">
                <div className="flex flex-col" style={{ width: 2 }}>
                  {rows.map((seg) => {
                    const draw = sidePopDelay(seg, side, state);
                    return (
                      <span
                        key={seg}
                        className={draw ? "bore-draw" : undefined}
                        style={{
                          display: "block",
                          height: SEGMENT_HEIGHTS[seg],
                          background: "var(--ink-2)",
                          ...(draw ? { animationDelay: `${draw.delayMs}ms` } : { opacity: 0 }),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* bedrock cards: rock → lit */}
        <div className="grid grid-cols-2 gap-3">
          {SIDES.map((side) => (
            <div
              key={side}
              className={["dig-rock rounded-xl px-3 py-1 text-center", flags.bedrockLit ? "rock-light" : ""]
                .filter(Boolean)
                .join(" ")}
              style={{
                background: flags.bedrockLit ? "var(--surface)" : "var(--rock)",
                border: `2px solid ${flags.bedrockLit ? PARTY[side].color : "var(--line)"}`,
                color: flags.bedrockLit ? "var(--ink-2)" : "var(--muted)",
              }}
            >
              <div className="text-[10px] leading-4 font-semibold uppercase tracking-wide">
                {t(lang, "bedrock")}
              </div>
            </div>
          ))}
        </div>

        {/* converging connector strokes */}
        <div className="relative" style={{ height: 18 }}>
          {SIDES.map((side) => (
            <span
              key={side}
              className="absolute block"
              style={{
                top: 0,
                width: 28,
                height: 2,
                ...(side === "a"
                  ? { left: "30%", transform: "rotate(38deg)", transformOrigin: "left center" }
                  : { right: "30%", transform: "rotate(-38deg)", transformOrigin: "right center" }),
              }}
            >
              <span
                className={flags.cruxLit ? "line-draw block" : "block"}
                style={{
                  height: 2,
                  background: "var(--muted)",
                  transformOrigin: side === "a" ? "left center" : "right center",
                  ...(flags.cruxLit
                    ? { animationDuration: flags.fastCrux ? "0.25s" : "0.4s" }
                    : { opacity: 0 }),
                }}
              />
            </span>
          ))}
        </div>

        {/* crux card: dim → lit with one spark */}
        <div
          className={["dig-crux rounded-xl px-3 py-1 text-center", flags.cruxLit ? "dig-lit" : ""]
            .filter(Boolean)
            .join(" ")}
          style={{
            background: "var(--surface)",
            border: "2px dashed var(--muted)",
            transitionDelay: cruxDelay,
          }}
        >
          <div
            className="text-[10px] leading-4 font-semibold uppercase tracking-wide"
            style={{ color: "var(--muted)" }}
          >
            <span
              className={flags.cruxLit ? "crux-spark" : undefined}
              style={{
                display: "inline-block",
                animationDelay: cruxDelay,
                animationDuration: flags.fastCrux ? "0.4s" : "0.5s",
              }}
            >
              ⚡
            </span>{" "}
            {/* the ⚡ animates separately, so strip it from the whole-string label */}
            {t(lang, "cruxShort").replace(/^⚡\s*/, "")}
          </div>
        </div>

        {/* three judges, one vote dot under each */}
        <div className="flex justify-center gap-6 mt-1.5">
          {[0, 1, 2].map((j) => (
            <div key={j} className="flex flex-col items-center gap-1">
              <span
                className={flags.judgesIn ? "judge-in inline-block" : "inline-block"}
                style={flags.judgesIn ? { animationDelay: `${j * 120}ms` } : { opacity: 0 }}
              >
                <span
                  className="weigh text-2xl"
                  style={{
                    animationDelay: `${j * 0.55}s`,
                    animationDirection: j === 1 ? "reverse" : undefined,
                  }}
                >
                  ⚖️
                </span>
              </span>
              <span
                className={flags.votesIn ? "dot-fill" : undefined}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  display: "inline-block",
                  background: flags.votesIn ? "var(--ink)" : "transparent",
                  border: `1.5px solid ${flags.votesIn ? "var(--ink)" : "var(--muted)"}`,
                  animationDelay: `${j * 300}ms`,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-center mt-1" style={{ color: "var(--muted)" }}>
        {t(lang, "thinking.helper")}
      </p>
    </div>
  );
}
