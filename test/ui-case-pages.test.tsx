import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountsRead } from "../components/case/AccountsRead";
import { AppealSection, appealArea, type AppealDraft } from "../components/case/AppealForm";
import { CasePanel, type CasePanelProps } from "../components/case/CaseScreen";
import type { EvidenceController } from "../components/case/EvidencePicker";
import { RespondPanel, respondStage, type RespondForm, type RespondPanelProps } from "../components/case/RespondScreen";
import { WriteSide, type SideDraft } from "../components/case/WriteSide";
import type { CaseView, LiveState } from "../lib/case-types";
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

const sideDraft: SideDraft = { ...draft };

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
      onShare={noop}
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
  it("awaiting: a row per side, share link, judge-now and only the owner's side, with no explanation", () => {
    const html = owner(OWNER.awaiting);
    expect(html).toContain(t("en", "case.side.waiting"));
    expect(html).toContain(t("en", "case.invite.share"));
    expect(html).not.toContain(OWNER.awaiting.inviteUrl as string);
    expect(html).not.toContain("verdict is held");
    expect(html).not.toContain("The link works");
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

  it("no side A yet: the link and the write form, no judge-now, no not-stored message", () => {
    const waiting = caseView({ sides: [], ownerSideMissing: true, canJudgeNow: false });
    const html = owner(waiting, { write: sideDraft });
    expect(html).toContain(t("en", "case.invite.share"));
    expect(html).toContain(esc(t("en", "case.write.placeholder")));
    expect(html).toContain(esc(t("en", "case.write.lead")));
    expect(html).toContain(t("en", "case.write.submit"));
    expect(html).not.toContain(esc(t("en", "case.judgeNow")));
    expect(html).not.toContain(esc(t("en", "owner.notStored")));
  });

  it("no side A yet, the other side already wrote: no link, the answered lead", () => {
    const waiting = caseView({
      sides: [],
      ownerSideMissing: true,
      canJudgeNow: false,
      respondentAnswered: true,
      inviteUrl: null,
      mode: "two_sided",
    });
    const html = owner(waiting, { write: sideDraft });
    expect(html).toContain(esc(t("en", "case.write.leadAnswered")));
    expect(html).not.toContain(esc(t("en", "case.write.lead")));
    expect(html).not.toContain(t("en", "case.invite.share"));
    expect(html).not.toContain(esc(t("en", "owner.notStored")));
  });

  it("side A written: no write form", () => {
    expect(owner(OWNER.awaiting, { write: sideDraft })).not.toContain(esc(t("en", "case.write.submit")));
  });

  it("WriteSide: the submit button waits for a long enough side", () => {
    const html = renderToStaticMarkup(<WriteSide lang="en" draft={sideDraft} answered={false} evidenceOn />);
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
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
    expect(html).not.toContain(t("en", "case.invite.share"));
  });

  it("awaiting: each side shows its live state", () => {
    const live = (states: LiveState[]) =>
      owner(
        caseView({
          live: states.map((state, i) => ({ party: (["b", "c", "d"] as const)[i], state })),
        }),
      );
    const html = live(["answered", "typing", "opened"]);
    expect(html).toContain(t("en", "case.side.answered"));
    expect(html).toContain(esc(t("en", "case.side.typing")));
    expect(html).toContain(t("en", "case.side.opened"));
    expect(html).toContain('data-state="typing"');
    // The letter is for the eye, the side's name for a screen reader.
    expect(html).toContain('class="sr-only">Party C');
    expect(html).not.toContain(esc(t("en", "case.accountB")));
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
    expect(awaiting).toContain(t("en", "case.invite.share"));
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
    expect(html).toContain(t("tr", "case.invite.share"));
    expect(html).toContain(t("tr", "case.side.waiting"));
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

  it("waiting for the owner's side: thanks them and shows no form", () => {
    const waiting = caseView({
      ...RESPONDENT.form,
      respondentAnswered: true,
      ownerSideMissing: true,
      mode: "two_sided",
    });
    expect(respondStage(waiting)).toBe("waiting");
    const html = respondent(waiting);
    expect(html).toContain(esc(t("en", "respond.sentWaiting")));
    expect(html).not.toContain("<textarea");
    // Once the owner has written, the answer is judging or closed as before.
    expect(respondStage({ ...waiting, ownerSideMissing: false })).toBe("closed");
  });

  it("an answer that expired unread keeps the expired note and the removal; a removed one says so", () => {
    const expired = caseView({ ...RESPONDENT.expired, respondentAnswered: true, ownerSideMissing: true });
    expect(respondStage(expired)).toBe("expired_answered");
    const html = respondent(expired, { onRemove: () => {} });
    expect(html).toContain(esc(t("en", "respond.expired")));
    expect(html).toContain(esc(t("en", "respond.remove")));
    const gone = respondent({ ...expired, removed: { at: expired.createdAt, parties: ["b"] } }, { onRemove: () => {} });
    expect(gone).toContain(esc(t("en", "case.removedBanner")));
    expect(gone).not.toContain(esc(t("en", "respond.expired")));
  });

  it("form: the language, the textarea, screenshots and the privacy promise", () => {
    const html = respondent(RESPONDENT.form);
    expect(html).not.toContain("weigh it by");
    expect(html).toContain("The verdict will be written in English.");
    expect(html).toContain(t("en", "respond.label"));
    expect(html).toContain(esc(t("en", "home.addContext")));
    expect(html).toContain(esc(t("en", "respond.privacy")));
    expect(html).toContain(t("en", "respond.submit"));
    // Nothing of the owner's account before the verdict.
    expect(html).not.toContain(esc(t("en", "case.accountA")));
  });

  it("form on an old free case: screenshots like any case", () => {
    const html = respondent(caseView({ ...RESPONDENT.form, tier: "free" }));
    expect(html).toContain(t("en", "respond.submit"));
    expect(html).toContain(esc(t("en", "home.addContext")));
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
    expect(form).not.toContain(esc(t("en", "home.addContext")));
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
});
