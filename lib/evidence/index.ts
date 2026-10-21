/**
 * Screenshot evidence: validation by magic bytes, in-memory transcription,
 * signed transcript tokens, submission anonymization with one name map per
 * case, and the judge-facing EVIDENCE block. Raw images are never stored;
 * raw transcripts live only inside the uploader's signed token.
 *
 * Server only. The public surface used by the cases package, the premium
 * pipeline and the evidence routes.
 */

export type {
  AnonymizedSubmission,
  EvidenceAudience,
  EvidenceGroup,
  KnownPerson,
  SubmissionInput,
  VerifiedEvidence,
} from "./types";

/** Parses multipart or JSON images, validates, transcribes, signs. The caller has done
 * auth, kill switch and rate limits. Answers 200 EvidenceUploadResponse or an ApiErrorBody. */
export { handleEvidenceUpload } from "./upload";

/** Verifies a submission's tokens: { ok, items } or "too_many_files" / "evidence_invalid". */
export { verifyEvidenceTokens } from "./token";

/** One model call; fails closed with AnonymizeError (lib/anonymize.ts). */
export { anonymizeSubmission } from "./anonymize";

/** Keyed fingerprints for names in one case (section 6.3). */
export { caseNameKeys } from "./names";

/** The judge-facing EVIDENCE block, or null when there is nothing. */
export { evidenceBlock } from "./block";

export { renderTranscript } from "./render";
export { sniffImage } from "./validate";
