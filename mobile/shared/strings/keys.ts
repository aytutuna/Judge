/**
 * Which lib/i18n.ts keys the native apps ship. An entry is an exact key or a
 * prefix ending in "*" ("error.*" matches every key starting with "error.").
 * Keep this list to what the apps render; the web dictionary has many page
 * strings (FAQ, privacy, pricing) the apps link to instead of showing.
 */
export const WEB_KEYS: readonly string[] = [
  // Home
  "hero.titleLine1",
  "hero.titleLine2",
  "hero.eyebrow",
  "hero.lead",
  "input.label",
  "placeholder",
  "getVerdict",
  "privacyNote",
  "privacyLink",
  "examples.label",
  "example.*",
  "home.*",
  "thread.*",
  "shell.today",
  "shell.new",
  // Value framework picker
  "judgeBy",
  "fineTune",
  "hideFineTune",
  "sliderNote",
  "preset.*",
  "slider.*",
  "advanced.summary",
  "advanced.current",
  // Judging state
  "thinking.*",
  // Verdict card
  "verdict.*",
  "lean.*",
  "splitWin",
  "splitWinSelf",
  "ifPrefix",
  "badge.*",
  "kind.*",
  "bedrock",
  "cruxShort",
  "cruxTitle",
  "mapTitle",
  "factsTitle",
  "bestPointTitle",
  "bestPoint.*",
  "stamp.*",
  "share",
  "copyLink",
  "copied",
  "shareText",
  "copyPrompt",
  "judgeAnother",
  "judgesVoted.*",
  "escalated",
  "translate.*",
  "vote.*",
  "refusedNote",
  "demoNote",
  "trial.*",
  "confidence",
  "verdictAria",
  "party.a",
  "party.b",
  "you",
  "notFound.title",
  "notFound.body",
  // Premium results can already be rendered (fact check, panel line).
  "panel.premium",
  "panel.models",
  "panel.strong",
  "panel.quick",
  "factcheck.*",
  // Errors and waits
  "errorFallback",
  "error.*",
  "wait.*",
  "turnstile.label",
  // Sign-in (Apple, Google, email code) and the account screen. The dev
  // login keys stay web-only.
  "signin.title",
  "signin.lead",
  "signin.apple",
  "signin.google",
  "signin.emailToggle",
  "signin.emailLabel",
  "signin.emailPlaceholder",
  "signin.emailSubmit",
  "signin.emailSent",
  "signin.emailInvalid",
  "signin.unavailable",
  "signin.providerUnavailable",
  "signin.failed",
  "signin.legal",
  "signin.legalLink",
  "signin.legalAfter",
  "signin.loading",
  "account.*",
  // Settings / links out to the website
  "footer.about",
  "footer.privacy",
  "footer.language",
  "footer.note",
  "how.title",
  "nav.signIn",
  "nav.account",
  "nav.pricing",
  "nav.signOut",
  // Premium, cases and appeals
  "tier.*",
  "clarify.*",
  "mode.*",
  "case.*",
  "respond.*",
  "evidence.*",
  "twoSided.*",
  "appeal.*",
  "names.*",
  "removed.*",
  "pricing.*",
  "langToggle.toTr",
  "langToggle.toEn",
];

/**
 * Exact web keys left out even though a WEB_KEYS prefix matches them: browser
 * copy ("new tab", "reload the page") with an app version in app-strings.ts.
 */
export const EXCLUDE_KEYS: readonly string[] = [
  "factcheck.sourceAria",
  "error.bad_origin",
  "signin.unavailable",
  "account.deleted",
  "pricing.preview",
  "pricing.signIn",
];

/**
 * Keys whose leading emoji the web design drops at render time
 * (stripLeadingEmoji in lib/text.ts) because it draws its own icon. The
 * export strips it once here, so the apps never see it.
 */
export const STRIP_EMOJI: readonly string[] = [
  "bedrock",
  "cruxShort",
  "cruxTitle",
  "factsTitle",
  "bestPointTitle",
  "share",
  "copyLink",
  "copied",
  "demoNote",
  "trial.*",
];

/** Keys that must exist in the export (fails loudly if one is renamed on
 * the web side, so a phase-1 screen never loses its copy silently). */
export const REQUIRED_KEYS: readonly string[] = [
  "getVerdict",
  "verdict.win",
  "verdict.winSelf",
  "judgesVoted.one",
  "judgesVoted.other",
  "error.too_short",
  "error.too_long",
  "error.rate_limited",
  "error.daily_cap",
  "error.quota",
  "error.unavailable",
  "error.captcha_failed",
  "thinking.read",
  "translate.loading",
  "signin.title",
  "signin.apple",
  "signin.google",
  "signin.legal",
  "signin.legalLink",
  "signin.legalAfter",
  "account.signedInAs",
  "account.signOut",
  "account.delete",
  "clarify.title",
  "evidence.label",
  "case.status.judged",
  "appeal.outcome.upheld",
];
