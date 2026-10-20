/** Shared shapes of the evidence package (re-exported by lib/evidence/index.ts). */

import type { Lang } from "@/lib/i18n";
import type { EvidenceKind, NameMapping } from "@/lib/types";

/** A verified transcript from a signed token, still raw (may contain names). Never stored. */
export type VerifiedEvidence = { kind: EvidenceKind; transcript: string };

/** Who a token was issued to. */
export type EvidenceAudience = { type: "user"; userId: string } | { type: "respondent"; caseId: string };

/** A persisted name fingerprint of a case. */
export type KnownPerson = { label: string; key: string };

export type SubmissionInput = {
  narrator: "Party A" | "Party B";
  /** The raw account or appeal text (clarification answers already folded in). */
  text: string;
  evidence: VerifiedEvidence[];
  lang: Lang;
  /** Two-sided: the person the narrator argues with is the other party label. */
  twoSided?: boolean;
  /** A side of a two-sided case: the rewritten account must name the other
   * party's label (a missing one triggers a retry, never a failure). */
  opponentRequired?: boolean;
  /** Earlier anonymized material of the case, for recognizing people by role. */
  roster?: { context: string; labelsInUse: string[] };
  /** Case name fingerprints (section 6.3). */
  names?: { keysFor: (name: string) => string[]; known: KnownPerson[] };
};

export type AnonymizedSubmission = {
  text: string;
  /** Same order and length as the input evidence; rendered and anonymized. */
  evidence: VerifiedEvidence[];
  /** Narrator as { original: "I", replacement: narrator }. Returned to the client only. */
  nameMap: NameMapping[];
  /** New fingerprints to persist (INSERT OR IGNORE). Empty without `names`. */
  people: KnownPerson[];
};

export type EvidenceGroup = { party: "a" | "b" | null; idPrefix: string; items: VerifiedEvidence[] };
