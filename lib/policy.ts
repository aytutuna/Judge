/** The privacy policy in force, as its last-updated date. Stored with every
 * consent choice and every new verdict. */
export const POLICY_VERSION = "2026-11-17";

/** The wording of the one-time agreement before a person's first verdict, in
 * English. The ledger keeps the text the person saw; this is what it falls
 * back to when the dictionary has no text for the key. */
export const SENSITIVE_AGREEMENT_EN =
  "My text may include private details, like health or relationships. Judge sends it, with names taken out, to an outside AI service provider to write my verdict, and keeps it until I remove it.";

/** The postal address under "Who we are"; the policy shows it only when it is not empty. */
export const OWNER_ADDRESS = "";
