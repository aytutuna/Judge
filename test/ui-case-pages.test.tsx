import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountsRead } from "../components/case/AccountsRead";
import { AppealSection, appealArea, type AppealDraft } from "../components/case/AppealForm";
import { CaseList } from "../components/case/CaseList";
import { CaseModeSwitch } from "../components/case/CaseModeSwitch";
import { CasePanel, type CasePanelProps } from "../components/case/CaseScreen";
import type { EvidenceController } from "../components/case/EvidencePicker";
import { InviteLink } from "../components/case/InviteLink";
import { RespondPanel, respondStage, type RespondForm, type RespondPanelProps } from "../components/case/RespondScreen";
import type { CaseView } from "../lib/case-types";
import { t } from "../lib/i18n";
import { OWNER, OWNER_NAMES, RESPONDENT, RESPONDENT_NAMES, caseView } from "./ui-case-fixtures";

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

const form: RespondForm = {
  text: "",
  setText: noop,
  name: "",
  setName: noop,
  evidence,
  setTurnstile: noop,
  turnstileKey: 0,
  sending: false,
  error: null,
  canSubmit: false,
  submit: async () => {},
};

function owner(view: CaseView, over: Partial<CasePanelProps> = {}): string {
  return renderToStaticMarkup(
    <CasePanel
      lang="en"
      view={view}
      names={OWNER_NAMES}
      overlay={null}
      onOverlayFinished={noop}
      fresh={false}
      busy={false}
      actionError={null}
      resetDone={false}
      onJudgeNow={noop}
      onRetry={noop}
      onReset={noop}
      onRemove={noop}
      appeal={draft}
      {...over}
    />,
  );
}

function respondent(view: CaseView, over: Partial<RespondPanelProps> = {}): string {
  return renderToStaticMarkup(
    <RespondPanel
      lang="en"
      view={view}
      token="AbCdEfGhIjKlMnOpQrStUv"
      names={RESPONDENT_NAMES}
      form={form}
      overlay={null}
      onOverlayFinished={noop}
      fresh={false}
      appeal={draft}
      turnstile={null}
      {...over}
    />,
  );
}

describe("owner case page", () => {
  it("awaiting: shows the invite link, the held credit, judge-now and only the owner's side", () => {
    const html = owner(OWNER.awaiting);
    expect(html).toContain(OWNER.awaiting.inviteUrl as string);
    expect(html).toContain(t("en", "case.invite.copy"));
    expect(html).toContain("The link works until October 27.");
    expect(html).toContain("1 verdict is held for this case. You get it back if nobody answers by October 27.");
    expect(html).toContain(t("en", "case.judgeNow"));
    expect(html).toContain(esc(t("en", "case.judgeNow.confirm")));
    expect(html).toContain(esc(t("en", "case.yourSide")));
    expect(html).toContain("Your account (Party A)");
    expect(html).not.toContain(esc(t("en", "case.accountB")));
    expect(html).toContain(t("en", "case.remove"));
    // "Make a new link" asks first: the link already sent stops working.
    expect(html).toContain(esc(t("en", "case.invite.resetConfirm")));
    expect(html).toContain(t("en", "case.invite.resetYes"));
  });

  it("awaiting: confirms a reset link in a status line", () => {
    expect(owner(OWNER.awaiting, { resetDone: true })).toContain(t("en", "case.invite.resetDone"));
  });

  it("judging: shows the judging card and hides delete", () => {
    const html = owner(OWNER.judging, { overlay: { done: false } });
    expect(html).toContain(t("en", "case.answered"));
    // Announced from a live region that is there before the text arrives.
    expect(html).toMatch(new RegExp(`role="status" aria-live="polite">${t("en", "case.answered")}<`));
    expect(html).toContain(t("en", "thinking.eyebrow"));
    expect(html).not.toContain(t("en", "case.remove"));
    expect(html).not.toContain(OWNER.awaiting.inviteUrl as string);
  });

  it("judged: verdict with names on the owner's side, two-sided blocks, both accounts and the appeal form", () => {
    const html = owner(OWNER.judged);
    expect(html).toContain("Deniz is right");
    expect(html).toContain(t("en", "twoSided.badge"));
    expect(html).toContain(t("en", "twoSided.agreed"));
    expect(html).toContain(t("en", "twoSided.decisive"));
    expect(html).toContain("Leans toward Deniz");
    expect(html).toContain(t("en", "twoSided.wouldChange"));
    expect(html).toContain("Evidence: 1 from Party A, 2 from Party B");
    expect(html).toContain(t("en", "case.accounts"));
    expect(html).toContain(esc(t("en", "case.accountB")));
    expect(html).toContain("Your account (Party A)");
    expect(html).toContain(t("en", "appeal.title"));
    expect(html).toContain(t("en", "appeal.lead"));
    expect(html).toContain(t("en", "appeal.submit"));
  });

  it("appealed: the outcome banner, the earlier verdict and the added context", () => {
    const html = owner(OWNER.appealed);
    expect(html).toContain(t("en", "appeal.outcome.changed"));
    expect(html).toContain(t("en", "appeal.bySelf"));
    expect(html).toContain(esc("Your screenshot of the March swap made the turn order unclear."));
    expect(html).toContain(t("en", "appeal.history"));
    expect(html).toContain(t("en", "appeal.previous"));
    expect(html).toContain("Context you added (Party A)");
    expect(html).toContain(esc(t("en", "appeal.used")));
  });

  it("failed: says the credit is back and offers a retry", () => {
    const html = owner(OWNER.failed);
    expect(html).toContain(t("en", "case.failedBody"));
    expect(html).toContain(t("en", "case.retry"));
  });

  it("expired: explains the refund and offers judging alone (after a confirm naming the cost) or starting over", () => {
    const html = owner(OWNER.expired);
    expect(html).toContain(t("en", "case.expiredBody"));
    expect(html).toContain(t("en", "case.judgeNow"));
    expect(html).toContain(t("en", "case.startOver"));
    expect(html).toContain(t("en", "case.judgeExpired.confirm"));
    expect(html).toContain(t("en", "case.judgeExpired.yes"));
    expect(html).not.toContain(esc(t("en", "case.judgeNow.confirm")));
  });

  it("an old free case mentions no held or returned credit, but judging it alone or again costs one", () => {
    const free = (v: CaseView) => caseView({ ...v, tier: "free" });
    const awaiting = owner(free(OWNER.awaiting));
    expect(awaiting).toContain(OWNER.awaiting.inviteUrl as string);
    expect(awaiting).not.toContain("verdict is held");
    const failed = owner(free(OWNER.failed));
    expect(failed).toContain(t("en", "case.failedBodyFree"));
    expect(failed).toContain("Trying again uses 1 verdict.");
    const expired = owner(free(OWNER.expired));
    expect(expired).toContain(t("en", "case.expiredBodyFree"));
    expect(expired).toContain(t("en", "case.judgeExpired.confirm"));
    expect(expired).toContain(t("en", "case.judgeExpired.yes"));
    expect(awaiting).not.toMatch(/credit|1 verdict/i);
    expect(failed).not.toMatch(/credit/i);
  });

  it("names the viewer's party when this browser has no names for the case", () => {
    const html = owner(OWNER.judged, { names: [] });
    // Owner is Party A; the verdict went to Party B.
    expect(html).toContain("Party B is right");
    expect(html).toContain("Party A (you)");
    expect(html).toContain("Your account (Party A)");
    const tr = owner(OWNER.judged, { names: [], lang: "tr" });
    expect(tr).toContain("Taraf A (sen)");
    expect(tr).toContain("Senin anlatımın (Taraf A)");
  });

  it("shows action errors as alerts", () => {
    expect(owner(OWNER.awaiting, { actionError: "Nope." })).toContain('role="alert">Nope.');
  });

  it("speaks Turkish", () => {
    const html = owner(OWNER.awaiting, { lang: "tr" });
    expect(html).toContain(t("tr", "case.invite.copy"));
    expect(html).toContain("27 Ekim");
  });
});

describe("respondent page", () => {
  it("decides the stage from the view", () => {
    expect(respondStage(RESPONDENT.form)).toBe("form");
    expect(respondStage(RESPONDENT.ownInvite)).toBe("own_invite");
    expect(respondStage(RESPONDENT.judging)).toBe("judging");
    expect(respondStage(RESPONDENT.judgedSignedOut)).toBe("verdict");
    expect(respondStage(RESPONDENT.withoutYou)).toBe("without_you");
    expect(respondStage(RESPONDENT.expired)).toBe("expired");
    expect(respondStage(caseView({ ...RESPONDENT.form, status: "judging", mode: "two_sided" }))).toBe("closed");
    expect(respondStage(caseView({ ...RESPONDENT.form, status: "failed", mode: "two_sided", respondentAnswered: true }))).toBe(
      "failed",
    );
  });

  it("form: the language, the textarea, screenshots and the privacy promise", () => {
    const html = respondent(RESPONDENT.form);
    expect(html).not.toContain("weigh it by");
    expect(html).toContain("The verdict will be written in English.");
    expect(html).toContain(t("en", "respond.label"));
    expect(html).toContain(esc(t("en", "evidence.add")));
    expect(html).toContain(esc(t("en", "respond.privacy")));
    expect(html).toContain(t("en", "respond.submit"));
    // Nothing of the owner's account before the verdict.
    expect(html).not.toContain(esc(t("en", "case.accountA")));
  });

  it("form on an old free case: screenshots like any case", () => {
    const html = respondent(caseView({ ...RESPONDENT.form, tier: "free" }));
    expect(html).toContain(t("en", "respond.submit"));
    expect(html).toContain(esc(t("en", "evidence.add")));
  });

  it("own invite: tells the owner to send it on, no form", () => {
    const html = respondent(RESPONDENT.ownInvite);
    expect(html).toContain(t("en", "respond.ownInvite"));
    expect(html).not.toContain(t("en", "respond.submit"));
  });

  it("judging: thanks them and shows only their own side", () => {
    const html = respondent(RESPONDENT.judging);
    expect(html).toContain(t("en", "respond.sent"));
    expect(html).toContain("Your account (Party B)");
    expect(html).not.toContain(esc(t("en", "case.accountA")));
  });

  it("verdict, signed out: the respondent is You, both accounts, and a sign-in upsell for appeals", () => {
    const html = respondent(RESPONDENT.judgedSignedOut);
    expect(html).toContain(esc("You're right"));
    expect(html).toContain("Leans your way");
    expect(html).toContain(esc(t("en", "case.accountA")));
    expect(html).toContain(t("en", "appeal.upsell").slice(0, 20));
    expect(html).toContain(t("en", "appeal.signIn"));
    // The invite token never goes into the sign-in link.
    expect(html).toContain('href="/signin?next=%2Fr"');
    expect(html).not.toContain("AbCdEfGhIjKlMnOpQrStUv");
    expect(html).toContain("Your account (Party B)");
  });

  it("verdict without names in this browser: the respondent is still told they are Party B", () => {
    const html = respondent(RESPONDENT.judgedSignedOut, { names: [] });
    expect(html).toContain("Party B (you)");
    expect(html).toContain(esc("You're right"));
  });

  it("verdict, Premium: the appeal form", () => {
    const html = respondent(RESPONDENT.judgedPremium);
    expect(html).toContain(t("en", "appeal.submit"));
  });

  it("evidence switched off on this server: no screenshot pickers, the forms still work", () => {
    const form = respondent(RESPONDENT.form, { evidence: false });
    expect(form).not.toContain(esc(t("en", "evidence.add")));
    expect(form).toContain(t("en", "respond.submit"));
    const appeal = respondent(RESPONDENT.judgedPremium, { evidence: false });
    expect(appeal).toContain(t("en", "appeal.submit"));
    expect(appeal).not.toContain('type="file"');
    const ownerAppeal = owner(OWNER.judged, { evidenceOn: false });
    expect(ownerAppeal).toContain(t("en", "appeal.submit"));
    expect(ownerAppeal).not.toContain('type="file"');
    expect(owner(OWNER.judged)).toContain('type="file"');
  });

  it("appeals on an old free case offer screenshots too", () => {
    const ownerAppeal = owner(caseView({ ...OWNER.judged, tier: "free" }));
    expect(ownerAppeal).toContain(t("en", "appeal.submit"));
    expect(ownerAppeal).toContain('type="file"');
    const appeal = respondent(caseView({ ...RESPONDENT.judgedPremium, tier: "free" }));
    expect(appeal).toContain(t("en", "appeal.submit"));
    expect(appeal).toContain('type="file"');
  });

  it("settled without them, or expired: says so calmly, with a next step, no verdict", () => {
    for (const [view, key] of [
      [RESPONDENT.withoutYou, "respond.withoutYou"],
      [RESPONDENT.expired, "respond.expired"],
    ] as const) {
      const html = respondent(view);
      expect(html).toContain(`role="status">${esc(t("en", key))}`);
      expect(html).not.toContain("_banner_");
      expect(html).toContain(esc(t("en", "respond.startOwn")));
      expect(html).toContain(`href="/">${t("en", "respond.startOwnCta")}`);
    }
  });
});

describe("appealArea", () => {
  it("covers every block reason", () => {
    expect(appealArea(OWNER.awaiting)).toEqual({ kind: "none" });
    expect(appealArea(OWNER.judged)).toEqual({ kind: "form", failed: null });
    expect(appealArea(OWNER.appealed)).toEqual({ kind: "used" });
    expect(appealArea(RESPONDENT.judgedSignedOut)).toEqual({ kind: "upsell", signIn: true });
    expect(appealArea({ ...RESPONDENT.judgedSignedOut, appeal: { allowed: false, blockedBy: "no_credits" } })).toEqual({
      kind: "upsell",
      signIn: false,
    });
    expect(appealArea({ ...OWNER.judged, appeal: { allowed: false, blockedBy: "no_credits" } })).toEqual({
      kind: "blocked",
      reason: "no_credits",
    });
    expect(appealArea({ ...OWNER.judged, appeal: { allowed: false, blockedBy: "not_party" } })).toEqual({ kind: "none" });
  });

  it("shows a judging appeal and a failed one", () => {
    const judging = {
      ...OWNER.appealed,
      appeals: [{ ...OWNER.appealed.appeals[0], status: "judging" as const }],
    };
    expect(appealArea(judging)).toEqual({ kind: "judging" });
    expect(appealArea({ ...judging, yourParty: "b" })).toEqual({ kind: "busy" });
    const failed = {
      ...OWNER.appealed,
      appeals: [{ ...OWNER.appealed.appeals[0], status: "failed" as const, error: "refused" as const }],
      appeal: { allowed: true, blockedBy: null },
    };
    expect(appealArea(failed)).toEqual({ kind: "form", failed: "refused" });
    const html = renderToStaticMarkup(<AppealSection lang="en" view={failed} signInHref="/signin" draft={draft} />);
    expect(html).toContain(esc(t("en", "appeal.refused")));
  });

  it("the owner without credits sees why, with a pricing link", () => {
    const html = renderToStaticMarkup(
      <AppealSection
        lang="en"
        view={{ ...OWNER.judged, appeal: { allowed: false, blockedBy: "no_credits" } }}
        signInHref="/signin"
        draft={draft}
      />,
    );
    expect(html).toContain(esc(t("en", "error.no_credits")));
    expect(html).toContain('href="/pricing"');
  });
});

describe("small case components", () => {
  it("InviteLink: labelled read-only field, copy, reset", () => {
    const html = renderToStaticMarkup(
      <InviteLink lang="en" url="https://x.test/r/abc" expiresAt="2026-10-27T09:00:00.000Z" onReset={noop} />,
    );
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Send this link to the other person<\/label>/);
    expect(html).toContain('readOnly=""');
    expect(html).toContain(t("en", "case.invite.reset"));
  });

  it("CaseModeSwitch: two radios with the matching hint", () => {
    const now = renderToStaticMarkup(<CaseModeSwitch lang="en" value="now" onChange={noop} />);
    expect(now.match(/type="radio"/g)).toHaveLength(2);
    expect(now).toContain(t("en", "mode.now"));
    expect(now).toContain(t("en", "mode.both"));
    expect(now).toContain(t("en", "mode.nowHint"));
    const both = renderToStaticMarkup(<CaseModeSwitch lang="tr" value="both" onChange={noop} />);
    expect(both).toContain(t("tr", "mode.bothHint"));
  });

  it("CaseModeSwitch locked (signed out): both sides says it needs sign-in, not Premium", () => {
    const html = renderToStaticMarkup(<CaseModeSwitch lang="en" value="now" onChange={noop} locked />);
    expect(html).toContain(t("en", "tier.lockedSignIn"));
    expect(html).not.toMatch(/premium/i);
  });

  it("AccountsRead: renders nothing without sides, transcripts as details", () => {
    expect(renderToStaticMarkup(<AccountsRead lang="en" title="x" sides={[]} />)).toBe("");
    const html = renderToStaticMarkup(<AccountsRead lang="en" title="x" sides={OWNER.judged.sides} />);
    expect(html).toContain("<details");
    expect(html).toContain("Image 1, as the judges read it");
  });

  it("AccountsRead: Turkish text shows Taraf/Kişi labels, English text keeps Party, whatever the interface", () => {
    const sides = [
      { party: "a" as const, text: "Party A'ya göre Party B cimrilik ediyor, çünkü ödemedi.", submittedAt: "2026-10-20T10:00:00.000Z", evidence: [] },
      { party: "b" as const, text: "Party B paid Person C back in April.", submittedAt: "2026-10-20T10:05:00.000Z", evidence: [] },
    ];
    for (const lang of ["en", "tr"] as const) {
      const html = renderToStaticMarkup(<AccountsRead lang={lang} title="x" sides={sides} yourParty="a" />);
      expect(html).toContain("Taraf A&#x27;ya göre Taraf B cimrilik ediyor");
      expect(html).toContain("Party B paid Person C back in April.");
      expect(html).not.toContain("Party A&#x27;ya");
    }
  });

  it("AppealOutcomeBanner: can take focus programmatically, not by Tab", async () => {
    const { AppealOutcomeBanner } = await import("../components/case/AppealOutcome");
    const html = renderToStaticMarkup(
      <AppealOutcomeBanner
        appeal={{
          by: "a",
          outcome: "upheld",
          previous_id: "v1",
          previous_verdict: "side_b",
          previous_confidence: 3,
          confidence_change: 0,
          summary: "",
        }}
        lang="en"
        byName="Party A"
        bySelf
        focus
      />,
    );
    expect(html).toMatch(/<section[^>]*tabindex="-1"/i);
  });

  it("CaseList: loading, empty, error and a list of links", () => {
    expect(renderToStaticMarkup(<CaseList lang="en" state={{ status: "loading" }} />)).toContain(t("en", "case.loading"));
    expect(renderToStaticMarkup(<CaseList lang="en" state={{ status: "ready", cases: [] }} />)).toContain(
      t("en", "case.list.empty"),
    );
    expect(renderToStaticMarkup(<CaseList lang="en" state={{ status: "error" }} />)).toContain(
      esc(t("en", "case.list.loadFailed")),
    );
    const html = renderToStaticMarkup(
      <CaseList
        lang="en"
        state={{
          status: "ready",
          cases: [
            {
              id: "c1",
              status: "judged",
              mode: "two_sided",
              createdAt: "2026-10-20T09:00:00.000Z",
              expiresAt: "2026-10-27T09:00:00.000Z",
              respondentAnswered: true,
              verdict: "side_b",
              headline: "Party B paid",
              excerpt: "Party A paid the April bill",
              removed: false,
            },
            {
              id: "c2",
              status: "awaiting_respondent",
              mode: null,
              createdAt: "2026-10-19T09:00:00.000Z",
              expiresAt: "2026-10-26T09:00:00.000Z",
              respondentAnswered: false,
              verdict: null,
              headline: null,
              excerpt: "Party A says the bike was theirs for March",
              removed: false,
            },
            {
              id: "c3",
              status: "expired",
              mode: null,
              createdAt: "2026-10-18T09:00:00.000Z",
              expiresAt: "2026-10-25T09:00:00.000Z",
              respondentAnswered: false,
              verdict: null,
              headline: null,
              excerpt: null,
              removed: false,
            },
          ],
        }}
      />,
    );
    expect(html).toContain('href="/c/c1"');
    expect(html).toContain("Party B paid");
    expect(html).toContain("Started October 20");
    // Unjudged cases are told apart by the start of the owner's side, else the date.
    expect(html).toContain("Party A says the bike was theirs for March");
    expect(html).toContain("Case from October 18");
    expect(html).not.toContain(`>${t("en", "case.title")}<`);
  });
});
