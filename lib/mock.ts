import type { FrameworkChoice, VerdictResult } from "./types";

/**
 * Demo mode: realistic canned verdicts when no GEMINI_API_KEY is configured.
 * Deterministic (seeded by the input) so the same argument always gets the
 * same verdict, and keyword-steered so the demo feels alive.
 */

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function mockVerdict(
  argument: string,
  _framework: FrameworkChoice,
): VerdictResult {
  const lower = argument.toLowerCase();
  const seed = hash(argument);

  const base = {
    demo: true as const,
    facts_relied_on: [] as string[],
    split_points: null,
    conditional: null,
  };

  if (/\b(mean|means|meaning|definition|define|real |really a|counts as)\b/.test(lower)) {
    return {
      ...base,
      verdict: "dissolved",
      dispute_type: "definitional",
      confidence: 4,
      runs: ["dissolved", "dissolved", "dissolved"],
      headline: "You're using the same word differently",
      crux: "Each side is using the key term to mean something different, so there is no factual disagreement left once the definitions are separated.",
      argument_map: {
        side_a: [
          { claim: "Uses the term in its everyday, informal sense", kind: "definition" },
          { claim: "By that sense, their statement is true", kind: "logic" },
        ],
        side_b: [
          { claim: "Uses the term in its strict, technical sense", kind: "definition" },
          { claim: "By that sense, their statement is also true", kind: "logic" },
        ],
        bedrock_a: "Words mean what people commonly use them to mean",
        bedrock_b: "Words mean what their strict definition says",
      },
      losing_side_best_point:
        "Neither side loses — both are right under their own definition.",
    };
  }

  if (/\b(freedom|liberty|safety|security|privacy|tradition|equality|loyalty)\b/.test(lower)) {
    return {
      ...base,
      verdict: "conditional",
      dispute_type: "values",
      confidence: 4,
      runs: ["conditional", "conditional", "conditional"],
      headline: "It depends on one value you don't share",
      crux: "Both sides agree on the facts; they disagree on which core value should win when the two collide.",
      conditional: [
        { if_value: "You weight individual autonomy highest", then: "Party A's position follows" },
        { if_value: "You weight protection from harm highest", then: "Party B's position follows" },
      ],
      argument_map: {
        side_a: [
          { claim: "People should decide risks for themselves", kind: "value" },
          { claim: "Restrictions set a dangerous precedent", kind: "fact" },
        ],
        side_b: [
          { claim: "Preventing harm justifies limits", kind: "value" },
          { claim: "Unchecked freedom hurts third parties", kind: "fact" },
        ],
        bedrock_a: "Autonomy is the highest good",
        bedrock_b: "Preventing suffering is the highest good",
      },
      losing_side_best_point:
        "There is no loser on the facts — only on the weighting of values.",
    };
  }

  if (/\b(fire|hire|promote|choose|pick|which one|who should)\b/.test(lower)) {
    return {
      ...base,
      verdict: "split",
      dispute_type: "mixed",
      confidence: 3,
      runs: ["split", "split", "side_a"],
      headline: "Each of you is right about something",
      crux: "Party A is right about the immediate performance question; Party B is right about the longer-term team impact.",
      split_points: [
        { party: "a", point: "On measurable output, A's read of the situation is accurate" },
        { party: "b", point: "On morale and long-term cost, B's concern is well-founded" },
      ],
      argument_map: {
        side_a: [
          { claim: "Recent results clearly favor one option", kind: "fact" },
          { claim: "Results should drive the decision", kind: "value" },
        ],
        side_b: [
          { claim: "The other option carries hidden long-term costs", kind: "fact" },
          { claim: "Team health outweighs short-term output", kind: "value" },
        ],
        bedrock_a: "Judge by measurable results",
        bedrock_b: "Judge by long-term consequences",
      },
      losing_side_best_point:
        "Both sides hold a piece of the answer; the decision needs an agreed goal first.",
    };
  }

  const winnerIsA = seed % 2 === 0;
  const winner = winnerIsA ? "side_a" : "side_b";
  return {
    ...base,
    verdict: winner,
    dispute_type: "factual",
    confidence: 5,
    runs: [winner, winner, winner],
    headline: winnerIsA ? "Party A is right — it's factual" : "Party B is right — it's factual",
    crux: "This bottoms out in a checkable fact, and the evidence points one way.",
    facts_relied_on: [
      "The central factual claim can be verified from common knowledge",
      "No disputed value judgment is needed to settle it",
    ],
    argument_map: {
      side_a: [
        { claim: "States the central factual claim", kind: "fact" },
        { claim: "Draws the direct conclusion from it", kind: "logic" },
      ],
      side_b: [
        { claim: "Disputes the factual claim", kind: "fact" },
        { claim: "Relies on a common misconception", kind: "logic" },
      ],
      bedrock_a: "What the evidence actually shows",
      bedrock_b: "What it feels like should be true",
    },
    losing_side_best_point:
      "The losing side's instinct is common and understandable — it just doesn't survive the evidence.",
  };
}
