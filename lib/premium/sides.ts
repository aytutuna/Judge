/**
 * The anonymize step for a verdict typed as three or four sides
 * (VerdictRequest.sides). Each side is anonymized as its own account, in
 * parallel, with the writer's side names known to all of them, so a person
 * mentioned in another side's text gets that side's label. People who are
 * not a side get Person E and up, numbered across the accounts in code
 * (the same name is the same person; anyone else is new). Server only.
 */

import { sideLabels, type PartyLabel } from "../anonymize";
import { bareName, canonicalLabel, EN_SELF } from "../names";
import { mergeNameMaps } from "../originals-types";
import { composeSides, partiesFor } from "../multi";
import type { Lang } from "../i18n";
import type { Clarification, NameMapping, TypedSide } from "../types";
import { withClarifications } from "./context";
import type { AnonymizedSubmission, KnownPerson, VerifiedEvidence } from "../evidence/types";

export type SidesPrepared = {
  anonymized: string;
  nameMap: NameMapping[];
  evidenceText: string | null;
  evidenceCount: number;
};

const PERSON = /(?<![\p{L}])Person ([E-Z])(?![\p{L}\p{N}])/gu;

/** The comparison form of a name for matching across accounts: case-folded
 * in Turkish, no accents. A description ("my sister", lowercase) or a word
 * under two letters never matches: it is a different person in each account. */
function nameKey(name: string): string | null {
  const bare = bareName(name);
  if (!bare || !/^\p{Lu}/u.test(bare) || EN_SELF.test(bare) || canonicalLabel(bare, 4)) return null;
  const key = bare.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/\s+/g, " ").trim();
  return (key.match(/\p{L}/gu) ?? []).length >= 2 ? key : null;
}

/**
 * Renumbers the "Person E".. labels of every account into one sequence:
 * a name seen in two accounts keeps one label, any other person (or an
 * unlisted label) gets the next free one. Returns the rewritten texts and
 * name maps in the same order; `more` are further texts of the same account
 * (evidence transcripts) rewritten the same way. Pure.
 */
export function unifyBystanders(
  accounts: readonly { text: string; nameMap: readonly NameMapping[]; more?: readonly string[] }[],
): { text: string; nameMap: NameMapping[]; more: string[] }[] {
  const byName = new Map<string, string>();
  let next = 69; // "E"
  const fresh = () => `Person ${String.fromCharCode(next++)}`;
  return accounts.map((acc) => {
    const relabel = new Map<string, string>();
    const take = (label: string, name?: string) => {
      if (relabel.has(label)) return;
      const key = name ? nameKey(name) : null;
      const known = key ? byName.get(key) : undefined;
      const to = known ?? fresh();
      if (key && !known) byName.set(key, to);
      relabel.set(label, to);
    };
    for (const m of acc.nameMap) {
      const label = canonicalLabel(m.replacement, 4);
      if (label?.startsWith("Person ")) take(label, m.original);
    }
    for (const text of [acc.text, ...(acc.more ?? [])]) for (const m of text.matchAll(PERSON)) take(`Person ${m[1]}`);
    const swap = (label: string) => relabel.get(label) ?? label;
    const rewrite = (text: string) => text.replace(PERSON, (whole) => swap(whole));
    return {
      text: rewrite(acc.text),
      more: (acc.more ?? []).map(rewrite),
      nameMap: acc.nameMap.map((m) => (relabel.has(m.replacement) ? { ...m, replacement: swap(m.replacement) } : { ...m })),
    };
  });
}

/**
 * Anonymizes the typed sides. Side A also gets the clarification answers and
 * the evidence (both belong to the person asking). Throws AnonymizeError, like
 * anonymizeSubmission, when a name could not be taken out.
 */
export async function anonymizeSides(input: {
  sides: readonly TypedSide[];
  clarifications?: Clarification[];
  lang: Lang;
  evidence?: VerifiedEvidence[];
}): Promise<SidesPrepared> {
  const { anonymizeSubmission, evidenceBlock } = await import("../evidence");
  const count = input.sides.length;
  const labels = sideLabels(count);
  const parties = partiesFor(count);
  const names = input.sides.map((s) => s.name?.trim() || null);
  const known: KnownPerson[] = names.flatMap((name, i) => {
    const key = name ? nameKey(name) : null;
    return key ? [{ label: labels[i], key }] : [];
  });
  const keysFor = (name: string) => {
    const key = nameKey(name);
    return key ? [key] : [];
  };

  const subs: AnonymizedSubmission[] = await Promise.all(
    input.sides.map((side, i) =>
      anonymizeSubmission({
        narrator: labels[i] as PartyLabel,
        text: i === 0 ? withClarifications(side.text, input.clarifications, input.lang) : side.text,
        evidence: i === 0 ? (input.evidence ?? []) : [],
        lang: input.lang,
        twoSided: true,
        sides: { count, names },
        names: { keysFor, known },
      }),
    ),
  );

  const unified = unifyBystanders(
    subs.map((s, i) => ({ text: s.text, nameMap: s.nameMap, more: i === 0 ? s.evidence.map((e) => e.transcript) : [] })),
  );
  // The writer typed every side. Side A's own "I" stays; for the others
  // the narrator word is not the writer, so each is listed by the name the
  // writer gave it.
  const maps = unified.map((u, i) => {
    const own = i === 0 ? u.nameMap : u.nameMap.filter((m) => !(m.original === "I" && m.replacement === labels[i]));
    const named = names[i] ? [{ original: names[i] as string, replacement: labels[i] }] : [];
    return [...own, ...named];
  });
  const nameMap = maps.reduce<NameMapping[]>((acc, m) => mergeNameMaps(acc, m), []);

  const evidenceItems = subs[0].evidence.map((e, i) => ({ ...e, transcript: unified[0].more[i] }));
  return {
    anonymized: composeSides(parties.map((party, i) => ({ party, text: unified[i].text }))),
    nameMap,
    evidenceCount: evidenceItems.length,
    evidenceText: evidenceItems.length ? evidenceBlock([{ party: null, idPrefix: "E", items: evidenceItems }]) : null,
  };
}
