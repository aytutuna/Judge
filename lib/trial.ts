/**
 * Crux trial: adversarial cross-examination of fact/logic winner rulings.
 *
 * When the judges declare a winner on factual or logical grounds, one
 * attacker call tries to break the ruling's basis and one adjudicator call
 * decides whether it survives. Survival feeds the computed confidence
 * (downward only) — one exchange is evidence about confidence, not a
 * superior court, so the verdict itself never changes.
 *
 * Hard invariant: the trial must never fail, 500, or indefinitely delay a
 * verdict. Every failure path returns null (failure-open) and the whole run
 * races a deadline.
 */

import { z } from "zod";
import { geminiJson } from "./gemini";
import type { Lang } from "./i18n";
import { CruxTrial, type VerdictResult } from "./types";

/** Upper bound on total trial time. The trial's calls share JUDGE_MODEL's
 * per-model RPM bucket with the 3 judge calls that just ran, so trial-time
 * 429s are the expected case, and geminiJson honors "retry in Ns" waits up
 * to 45s per attempt — unbounded, that adds minutes behind platform/proxy
 * timeouts. On deadline the abandoned call may still complete and spend its
 * quota; acceptable — it was already issued. */
const TRIAL_DEADLINE_MS = 60_000;

export const ATTACKER_SYSTEM = `You are a cross-examiner in an argument-settling app. A panel of judges ruled on a dispute between Party A and Party B, deciding it on factual or logical grounds. Your job is to stress-test that ruling: produce the SINGLE strongest attack on the FACTUAL or LOGICAL basis of the ruling.

WHAT COUNTS AS AN ATTACK:
- Concrete counter-evidence: a well-established fact that contradicts a fact the ruling relies on, or shows it is outdated, misstated, or does not apply here.
- A named logical flaw in the ruling's inference: e.g. a false dichotomy, an unsupported generalization, affirming the consequent, a hidden premise doing the real work, a conclusion that does not follow even if every listed fact is true.

RULES:
- Use only well-established knowledge. Never invent facts, studies, statistics, or sources — a fabricated attack is worthless and will be thrown out.
- No rhetoric: no appeals to feelings, fairness, sympathy, stakes, or how either party was described. You attack the ruling's basis, not the losing party, and you do not re-argue their case.
- Pick the ONE strongest line of attack and make it precise. One sharp attack beats three vague ones.
- If no facts are listed, the ruling rests on logic — attack the inference.
- If the ruling rests entirely on the user's value framework rather than on fact or logic, say so and concede — that is not attackable ground.
- Concede only if you can construct no factual or logical challenge at all; a weak attack is more useful than a false concession. Do not concede merely because the ruling seems reasonable — reasonable rulings with a real weak point are exactly what you are here to catch.
- If, after honestly trying, no substantive attack exists, set has_substantive_attack to false and use the attack field to state plainly why nothing sticks.

OUTPUT:
- attack: 1–3 concrete sentences. The challenge itself when attacking; the honest explanation of why the basis holds when conceding.
- has_substantive_attack: true only if attack contains a real factual or logical challenge to the ruling's basis.`;

export const ADJUDICATOR_SYSTEM = `You are an impartial referee in an argument-settling app. A panel of judges ruled on a dispute between Party A and Party B on factual or logical grounds, and a cross-examiner has attacked that ruling. Decide whether the ruling's stated basis survives the attack.

THE RULING DESERVES NO DEFERENCE and you are not defending it. Judge only whether the attack defeats the stated basis. "survived" must be earned by the attack failing, not granted by default.

OUTCOMES:
- "overturned": ONLY when the attack identifies a concrete factual error or logical flaw that defeats the ruling's basis — if the attack is right, the ruling's stated grounds no longer support its conclusion.
- "uncertain": the attack raises real doubt but does not defeat the basis. Partial quibbles, plausible-but-unresolved factual challenges, and "more research would be needed" all land here — as does strong rhetoric that gestures at a real weakness without pinning it down.
- "survived": the attack fails — it misses the stated basis, rests on invented or fringe claims, restates the losing side's case, or is pure rhetoric.

RULES:
- Judge the attack against well-established knowledge only. An attack built on facts you cannot recognize as established fails; do not credit it just because it sounds specific.
- Scope is narrow: the ruling's stated basis versus the attack. Do not re-litigate the whole argument, and do not import new grounds to rescue or to sink the ruling.
- reasoning: at most 2 sentences, concrete — say what the attack got right or where it failed.`;

/** Appended to BOTH trial system prompts when the request asked for Turkish.
 * The outcome enum stays English (stored data invariant). */
const TR_TRIAL_BLOCK = `

LANGUAGE: Write the attack and reasoning text in natural, fluent, everyday Turkish, addressing the reader with informal "sen", never "siz". Refer to the parties as "Taraf A" and "Taraf B". Keep all JSON enum values exactly as specified in the schema (English identifiers).`;

/** Gemini responseSchema (OpenAPI subset), mirroring lib/judge.ts style. */
const ATTACKER_SCHEMA = {
  type: "object",
  properties: {
    attack: { type: "string" },
    has_substantive_attack: { type: "boolean" },
  },
  required: ["attack", "has_substantive_attack"],
} as const;

const ADJUDICATOR_SCHEMA = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["survived", "overturned", "uncertain"] },
    reasoning: { type: "string" },
  },
  required: ["outcome", "reasoning"],
} as const;

/** responseSchema is a hint, not a guarantee — geminiJson returns an
 * unvalidated cast, so every payload is safeParsed before use. */
const AttackerOutput = z.object({
  attack: z.string(),
  has_substantive_attack: z.boolean(),
});

/**
 * Should this result be cross-examined? True only for declared winners on
 * fact/logic ground with enough confidence for a cap to matter. Pure
 * predicate over the result — the CRUX_TRIAL env check stays in the route.
 */
export function shouldTryCrux(result: VerdictResult): boolean {
  return (
    // A winner was declared — split/conditional/dissolved/too_close have no
    // single ruling to attack.
    (result.verdict === "side_a" || result.verdict === "side_b") &&
    // Only fact/logic ground is testable. A framework-decided values win has
    // no factual basis to attack; "mixed" is included because a winner ruling
    // on a mixed dispute rests on its fact/logic component (the attacker
    // prompt carries an escape hatch for the purely-values residual case).
    (result.dispute_type === "factual" ||
      result.dispute_type === "logical" ||
      result.dispute_type === "mixed") &&
    // Optional field, absent on normal aggregate output — absent counts as
    // not refused.
    result.model_refused !== true &&
    // At confidence 1–2 neither cap (uncertain → 3, overturned → 2) can move
    // the number, so the trial would spend 2 calls for zero numeric effect.
    result.confidence >= 3
  );
}

/**
 * Apply a trial to a result: attach it and cap confidence. Caps, never
 * decrements — one adversarial exchange is evidence about confidence, not a
 * superior court. `uncertain → 3` lands at the existing "2/3 majority" tier
 * (real doubt exists), `overturned → 2` at the "opposite-side dissenter"
 * tier; confidence 1 stays reserved for verdicts where no ruling stands at
 * all. Confidence NEVER increases and the verdict/headline never change.
 * Pure: returns a new object, never mutates the input.
 */
export function applyCruxTrial(result: VerdictResult, trial: CruxTrial): VerdictResult {
  const cap =
    trial.outcome === "overturned" ? 2 : trial.outcome === "uncertain" ? 3 : Infinity;
  return {
    ...result,
    crux_trial: trial,
    confidence: Math.min(result.confidence, cap),
  };
}

/** Compact ruling summary both trial calls receive. */
function rulingSummary(result: VerdictResult): string {
  const facts = result.facts_relied_on.length
    ? result.facts_relied_on.map((f) => `- ${f}`).join("\n")
    : "(none listed — the ruling rests on logic, not contested facts)";
  return [
    `WINNING SIDE: ${result.verdict === "side_a" ? "Party A" : "Party B"}`,
    `DISPUTE TYPE: ${result.dispute_type}`,
    `CRUX: ${result.crux}`,
    `FACTS RELIED ON:\n${facts}`,
    `PARTY A'S BEDROCK PREMISE: ${result.argument_map.bedrock_a}`,
    `PARTY B'S BEDROCK PREMISE: ${result.argument_map.bedrock_b}`,
  ].join("\n");
}

async function trialCalls(
  anonymizedArgument: string,
  result: VerdictResult,
  isExpired: () => boolean,
  lang: Lang,
): Promise<CruxTrial | null> {
  const summary = rulingSummary(result);
  const context = `THE ARGUMENT:\n\n${anonymizedArgument}\n\nTHE RULING:\n\n${summary}`;
  const trBlock = lang === "tr" ? TR_TRIAL_BLOCK : "";

  const attackRes = await geminiJson<unknown>({
    system: `${ATTACKER_SYSTEM}${trBlock}`,
    user: context,
    schema: ATTACKER_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.8,
  });
  if (!attackRes.ok) {
    console.warn(
      "[trial] attacker call failed:",
      attackRes.blocked ? `blocked (${attackRes.reason})` : attackRes.error,
    );
    return null;
  }
  const attacker = AttackerOutput.safeParse(attackRes.data);
  if (!attacker.success) {
    console.warn(
      "[trial] attacker payload mismatch:",
      attacker.error.message.slice(0, 200),
    );
    return null;
  }

  // Concession (explicit, or an empty attack that must never reach the
  // adjudicator): the ruling survives without the second call. The attack
  // text is kept — it states why nothing stuck and is shown in the UI.
  if (!attacker.data.has_substantive_attack || attacker.data.attack.trim() === "") {
    return { attack: attacker.data.attack, outcome: "survived", reasoning: "" };
  }

  // If the deadline already fired, the route has shipped the verdict untried
  // and this result would be discarded. The accepted cost is narrower than
  // "keep going": only calls already in flight at deadline time may still
  // spend quota — never a brand-new adjudicator call (with its own retry
  // loop) burning the JUDGE_MODEL RPM bucket the next user's judges need.
  if (isExpired()) return null;

  const adjRes = await geminiJson<unknown>({
    system: `${ADJUDICATOR_SYSTEM}${trBlock}`,
    user: `${context}\n\nTHE ATTACK:\n\n${attacker.data.attack}`,
    schema: ADJUDICATOR_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.2,
  });
  if (!adjRes.ok) {
    console.warn(
      "[trial] adjudicator call failed:",
      adjRes.blocked ? `blocked (${adjRes.reason})` : adjRes.error,
    );
    return null;
  }

  // Assemble and validate before returning: a bad payload attached to the
  // result would be persisted, then fail VerdictResult.safeParse on
  // read-back and 404 the shared page. Failure-open instead.
  const raw = (adjRes.data ?? {}) as Record<string, unknown>;
  const trial = CruxTrial.safeParse({
    attack: attacker.data.attack,
    outcome: raw.outcome,
    reasoning: raw.reasoning,
  });
  if (!trial.success) {
    console.warn(
      "[trial] adjudicator payload mismatch:",
      trial.error.message.slice(0, 200),
    );
    return null;
  }
  return trial.data;
}

/**
 * Run the trial: attacker, then adjudicator (sequential — free-tier RPM).
 * Never throws, never exceeds its deadline; every failure path resolves
 * null so the verdict ships untried.
 */
export async function runCruxTrial(
  anonymizedArgument: string,
  result: VerdictResult,
  lang: Lang = "en",
): Promise<CruxTrial | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        expired = true;
        console.warn("[trial] deadline exceeded — shipping the verdict untried");
        resolve(null);
      }, TRIAL_DEADLINE_MS);
    });
    // geminiJson can reject (e.g. its un-caught res.json() on a malformed 200
    // body); a request that already holds a good verdict must not 500. The
    // catch is attached to the work promise itself so a rejection after the
    // deadline fires cannot become an unhandled rejection.
    const work = trialCalls(anonymizedArgument, result, () => expired, lang).catch((e: unknown) => {
      console.warn("[trial] failed open:", e instanceof Error ? e.message : String(e));
      return null;
    });
    return await Promise.race([work, deadline]);
  } catch (e) {
    // Belt and braces: nothing above should throw, but the invariant is
    // absolute — the trial must never break a verdict that already exists.
    console.warn("[trial] failed open:", e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    // Clear the timer so neither tests nor the server hold the event loop.
    if (timer !== undefined) clearTimeout(timer);
  }
}
