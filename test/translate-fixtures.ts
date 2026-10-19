import { extractText, planSegments, type TranslatableText } from "../lib/translate";
import type { VerdictResult } from "../lib/types";

/** A Turkish verdict with every optional text group present. */
export const TR_RESULT: VerdictResult = {
  verdict: "split",
  dispute_type: "mixed",
  confidence: 3,
  headline: "İkisi de kısmen haklı",
  crux: "Taraf A'nın iddiası ile Taraf B'nin itirazı",
  split_points: [
    { party: "a", point: "Taraf A botanik konusunda haklı." },
    { party: "b", point: "Taraf B mutfak konusunda haklı." },
  ],
  conditional: [{ if_value: "botaniğe bakıyorsan", then: "Taraf A kazanır." }],
  argument_map: {
    side_a: [{ claim: "Domates bir meyvedir.", kind: "fact" }],
    side_b: [
      { claim: "Domates sebze gibi pişirilir.", kind: "definition" },
      { claim: "Kimse salataya meyve demez.", kind: "value" },
    ],
    bedrock_a: "Bilimsel sınıflandırma geçerlidir.",
    bedrock_b: "Günlük kullanım geçerlidir.",
  },
  facts_relied_on: ["Domates çiçekten gelişir."],
  losing_side_best_point: "Mutfakta kimse domatese meyve demez.",
  runs: ["split", "side_a", "split"],
  demo: false,
  crux_trial: { attack: "Saldırı metni.", outcome: "uncertain", reasoning: "" },
  lean: { party: "a", unanimous: false, reason: "Taraf A'nın tanımı daha sağlam." },
  escalated: true,
  lang: "tr",
};

/** What a well-behaved model returns for TR_RESULT -> en. */
export const EN_TEXT: TranslatableText = {
  headline: "Both are partly right",
  crux: "Party A's claim against Party B's objection",
  split_points: ["Party A is right about botany.", "Party B is right about cooking."],
  conditional: [{ if_value: "you go by botany", then: "Party A wins." }],
  side_a: ["A tomato is a fruit."],
  side_b: ["Tomatoes are cooked like vegetables.", "Nobody calls a salad fruit."],
  bedrock_a: "Scientific classification counts.",
  bedrock_b: "Everyday usage counts.",
  facts_relied_on: ["Tomatoes develop from a flower."],
  losing_side_best_point: "In the kitchen nobody calls a tomato a fruit.",
  lean_reason: "Party A's definition holds up better.",
  crux_trial: { attack: "The attack.", reasoning: "" },
};

/** EN_TEXT as the model's segment reply to TR_RESULT's segments (the empty
 * crux_trial.reasoning is not sent, so both plans line up). */
export const EN_REPLY = {
  segments: planSegments(EN_TEXT, "en").segments.map(({ i, text }) => ({ i, text })),
};

/** The reply that echoes TR_RESULT's own text back. */
export const TR_ECHO_REPLY = {
  segments: planSegments(extractText(TR_RESULT), "en").segments.map(({ i, text }) => ({ i, text })),
};
