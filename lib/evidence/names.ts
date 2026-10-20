/**
 * Keyed, per-case name fingerprints. They let the second account (and every
 * appeal) give a person mentioned by name the same label as before, without
 * the server ever keeping the name: a key is HMAC(server key, caseId + name),
 * so a database alone reveals nothing and the same name in two cases is not
 * linkable.
 */

import { createHmac } from "node:crypto";
import { derivedSecret } from "@/lib/auth";
import { bareName, canonicalLabel, EN_SELF } from "@/lib/names";

/**
 * The comparable form of a name: bare (no suffix), single spaces, Turkish
 * lowercase, then without diacritics and dotless i, so the spellings people
 * type on different keyboards match ("Ayşe" / "Ayse", "Işık" / "Isik",
 * "Ian" / "ian").
 */
export function normalizeName(name: string): string {
  return bareName(name)
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .normalize("NFC");
}

function isKeyable(n: string): boolean {
  if ((n.match(/\p{L}/gu) ?? []).length < 2) return false;
  if (canonicalLabel(n)) return false;
  // Turkish first-person words are not excluded: the name map already turns
  // a Turkish narrator into "I", and "Ben" is a real name in English.
  return !EN_SELF.test(n);
}

/**
 * keysFor(name) for one case: the key of the whole name and, for a name of
 * two or more words, of its first word ("Deniz Yılmaz" also matches a later
 * "Deniz"). The narrator ("I", "me"), labels and one-letter names get no
 * key. Without a configured auth secret every name gets no key.
 */
export function caseNameKeys(caseId: string, env?: Record<string, string | undefined>): (name: string) => string[] {
  const secret = derivedSecret("case-names", env);
  return (name: string) => {
    if (!secret || canonicalLabel(bareName(name))) return [];
    const n = normalizeName(name);
    const forms = [n];
    const words = n.split(" ");
    if (words.length >= 2) forms.push(words[0]);
    const keys: string[] = [];
    for (const form of forms) {
      if (!isKeyable(form)) continue;
      const key = createHmac("sha256", secret).update(`${caseId}\u0000${form}`).digest("hex").slice(0, 32);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  };
}
