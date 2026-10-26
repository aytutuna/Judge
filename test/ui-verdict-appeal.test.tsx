import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppealSection, appealArea, type AppealDraft, type AppealSubject } from "../components/case/AppealForm";
import type { EvidenceController } from "../components/case/EvidencePicker";
import { VerdictHistory } from "../components/case/VerdictHistory";
import { SharedVerdict } from "../components/SharedVerdict";
import { useVerdictAppeal, withRoundNames } from "../components/VerdictAppeal";
import { VerdictView } from "../components/VerdictView";
import { t } from "../lib/i18n";
import type { VerdictResult } from "../lib/types";

/** Server-rendered "Add context" on one-sided verdicts: the card action,
 * the shared appeal area with the verdict's own limits, and the share page
 * showing the latest round. */

const noop = () => {};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

const evidence: EvidenceController = {
  items: [],
  tokens: [],
  busy: false,
  full: false,
  failure: null,
  overLimit: false,
  add: noop,
  remove: noop,
  clear: noop,
};

const draft: AppealDraft = {
  text: "",
  setText: noop,
  evidence,
  sending: false,
  error: null,
  canSubmit: false,
  submit: async () => {},
};

const first: VerdictResult = {
  verdict: "side_b",
  dispute_type: "factual",
  headline: "Party B has the receipts",
  crux: "Whether the April bill was paid",
  split_points: null,
  conditional: null,
  argument_map: {
    side_a: [{ claim: "Paid in April", kind: "fact" }],
    side_b: [{ claim: "Account showed unpaid", kind: "fact" }],
    bedrock_a: "a",
    bedrock_b: "b",
  },
  facts_relied_on: [],
  losing_side_best_point: "Party A says it was paid",
  confidence: 3,
  runs: ["side_b", "side_b", "side_a"],
  demo: false,
  lang: "en",
};

const round: VerdictResult = {
  ...first,
  verdict: "side_a",
  headline: "The bank receipt settles it for Party A",
  tier: "premium",
  appeal: {
    by: "a",
    outcome: "overturned",
    previous_id: "first1",
    previous_verdict: "side_b",
    previous_confidence: 3,
    confidence_change: 1,
    summary: "The bank receipt showed the payment.",
  },
};

const subject = (appeal: AppealSubject["appeal"], appeals: AppealSubject["appeals"] = []): AppealSubject => ({
  status: "judged",
  role: "owner",
  yourParty: "a",
  appeals,
  appeal,
});

describe("Add context on a one-sided verdict", () => {
  it("is the card's action for the writer only", () => {
    const own = renderToStaticMarkup(<VerdictView result={first} shareId="first1" lang="en" onAddContext={noop} />);
    expect(own).toMatch(new RegExp(`<button type="button" class="[^"]+">${t("en", "appeal.title")}</button></div>`));
    const other = renderToStaticMarkup(<VerdictView result={first} shareId="first1" lang="en" />);
    expect(other).not.toContain(t("en", "appeal.title"));
  });

  it("uses the case appeal's states, with the verdict's own lead and limit", () => {
    const form = renderToStaticMarkup(
      <AppealSection lang="en" view={subject({ allowed: true, blockedBy: null })} signInHref="/signin" draft={draft} lead="appeal.leadVerdict" />,
    );
    expect(form).toContain(esc(t("en", "appeal.leadVerdict")));
    expect(form).toContain(t("en", "appeal.submit"));

    const limited = subject({ allowed: false, blockedBy: "appeal_limit" });
    expect(appealArea(limited)).toEqual({ kind: "limit" });
    expect(renderToStaticMarkup(<AppealSection lang="tr" view={limited} signInHref="/signin" draft={draft} />)).toContain(
      esc(t("tr", "appeal.limit")),
    );

    const signedOut = renderToStaticMarkup(
      <AppealSection lang="en" view={subject({ allowed: false, blockedBy: "signin_required" })} signInHref="/signin?next=%2Fv%2Ffirst1" draft={draft} />,
    );
    expect(signedOut).toContain('href="/signin?next=%2Fv%2Ffirst1"');
    expect(signedOut).toContain(t("en", "appeal.signIn"));

    const free = renderToStaticMarkup(
      <AppealSection lang="en" view={subject({ allowed: false, blockedBy: "premium_required" })} signInHref="/signin" draft={draft} />,
    );
    expect(free).toContain(esc(t("en", "error.premium_required")));
    expect(free).toContain('href="/pricing"');

    const failed = subject({ allowed: true, blockedBy: null }, [{ party: "a", status: "failed", error: "unavailable" }]);
    expect(appealArea(failed)).toEqual({ kind: "form", failed: "failed" });
  });

  it("the share page shows the latest round with its outcome, under the first verdict's link", () => {
    const html = renderToStaticMarkup(
      <SharedVerdict
        id="first1"
        result={first}
        createdAt="2026-10-20 10:00:00"
        rounds={[{ id: "round1", result: round, createdAt: "2026-10-21 10:00:00" }]}
        initialLang="en"
      />,
    );
    expect(html).toContain(round.headline);
    expect(html).not.toContain(first.headline);
    expect(html).toContain(t("en", "appeal.outcome.overturned"));
    expect(html).toContain("The bank receipt showed the payment.");
    // Nobody is known as the writer while server rendering: no action.
    expect(html).not.toContain(`${t("en", "appeal.title")}</button>`);
  });

  it("starts from what the page shows and offers nothing before the writer is known", () => {
    let seen: ReturnType<typeof useVerdictAppeal> | null = null;
    function Probe() {
      seen = useVerdictAppeal({
        id: "first1",
        lang: "en",
        token: null,
        enabled: true,
        initial: [{ id: "first1", result: first, createdAt: "" }],
        evidence: false,
      });
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(seen!.verdicts.map((v) => v.id)).toEqual(["first1"]);
    expect(seen!.onAddContext).toBeUndefined();
    expect(seen!.panel).toBeNull();
    expect(seen!.finished).toBe(false);
  });

  it("lists the earlier verdicts and merges a round's new names", () => {
    const html = renderToStaticMarkup(
      <VerdictHistory
        lang="en"
        verdicts={[
          { id: "first1", result: first, createdAt: "2026-10-20T10:00:00.000Z" },
          { id: "round1", result: round, createdAt: "2026-10-21T10:00:00.000Z" },
        ]}
        linked={false}
        names={[]}
        selfParty="A"
        viewerIsSelfParty={false}
      />,
    );
    expect(html).toContain(t("en", "appeal.history"));
    expect(html).toContain(first.headline);
    expect(html).not.toContain(round.headline);

    const base = [{ original: "I", replacement: "Party A" }];
    expect(withRoundNames(base, [])).toBe(base);
    expect(
      withRoundNames(base, [
        { original: "I", replacement: "Party A" },
        { original: "Selin", replacement: "Person C" },
      ]),
    ).toEqual([...base, { original: "Selin", replacement: "Person C" }]);
  });
});
