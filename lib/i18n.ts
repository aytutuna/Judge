import { langTag, type Lang } from "./langs";
import tr from "./locales/tr";
import type { ClaimKind } from "./types";

/**
 * UI dictionary: every user-facing string, one WHOLE string per language.
 * Never build a sentence or label by concatenating translated fragments —
 * templates only interpolate names/numbers into slots the string was
 * designed around (predicate-final in Turkish, so no suffix ever attaches
 * to an inserted name).
 *
 * Pure module (no "use client") — safe to import from server code.
 */

export type { Lang } from "./langs";

const en = {
  "hero.title": "Who's right? Settle it.",
  "hero.titleLine1": "Who's right?",
  "hero.titleLine2": "Settle it.",
  "hero.eyebrow": "Three independent judges · Judges never see names",
  "hero.lead":
    "Tell us what the fight is about. Three AI judges each make the call on their own, and the confidence score shows how much they agree.",
  "input.label": "The argument",
  "input.labelTwoSided": "Your side",
  placeholderTwoSided: "What happened, from where you stand? They'll tell theirs.",
  placeholder:
    "What happened? Who says what, and why?\n\nPut the other person's side the way they'd say it. The judges build the strongest case for both sides either way.",
  getVerdict: "Get the verdict",
  "thinking.eyebrow": "What the judges are doing",
  "thinking.read": "Reading both sides and giving each its best shot…",
  "thinking.label": "Sorting each claim into fact, value, definition or logic…",
  "thinking.dig": "Digging down to bedrock…",
  "thinking.reach": "Finding what each side really stands on…",
  "thinking.crux": "Hunting for the crux…",
  "thinking.judges": "Three judges deciding, each on their own…",
  "thinking.votes": "Counting the votes…",
  "thinking.helper":
    "Three AI judges rule separately, and a close call brings in more. Give it a minute.",
  "thinking.finish": "Closing in on the crux…",
  "thinking.stillJudging": "The judges are still thinking. Hang in there…",
  "thinking.ready": "Verdict's ready.",
  "verdict.win": "{name} is right",
  "verdict.winSelf": "You're right",
  "verdict.split": "Split decision",
  "verdict.conditional": "It depends on your values",
  "verdict.dissolved": "Same word, different meanings",
  "verdict.tooClose": "Too close to call",
  "lean.title": "Forced ruling: {name} is more right",
  "lean.titleSelf": "Forced ruling: you're more right",
  "lean.unanimous": "All the judges leaned this way.",
  "lean.majority": "The judges leaned this way {for}–{against}.",
  "lean.tie": "Even when pushed to pick, the judges split down the middle.",
  splitWin: "{name} is right:",
  splitWinSelf: "You're right about this:",
  ifPrefix: "If",
  "badge.factual": "Factual dispute",
  "badge.logical": "Logical dispute",
  "badge.definitional": "Definitional dispute",
  "badge.values": "Values dispute",
  "badge.mixed": "Mixed dispute",
  "kind.fact": "fact",
  "kind.value": "value",
  "kind.definition": "definition",
  "kind.logic": "logic",
  bedrock: "🪨 Bedrock",
  why: "Why",
  cruxShort: "⚡ The crux",
  cruxTitle: "⚡ The crux: what this is really about",
  mapTitle: "The argument, down to bedrock",
  factsTitle: "Facts this verdict leans on (go check them)",
  bestPointTitle: "🤍 The other side's best point",
  share: "📤 Share",
  copyLink: "🔗 Copy link",
  copied: "✓ Link copied",
  shareText: "We let the judges settle it. See who won.",
  copyPrompt: "Copy this link:",
  judgeAnother: "Settle another one",
  "judgesVoted.one": "1 independent AI judge voted:",
  "judgesVoted.other": "{n} independent AI judges voted:",
  escalated: "It was close, so we called in extra judges.",
  "translate.loading": "Translating…",
  "translate.from.en": "Translated from English",
  "translate.from.tr": "Translated from Turkish",
  "translate.failed": "Couldn't translate it just now, so here's the original.",
  "translate.toggle": "Verdict language",
  "vote.split": "split",
  "vote.conditional": "depends",
  "vote.dissolved": "word mix-up",
  refusedNote: "The AI sat this one out. We'd rather show nothing than fake a ruling.",
  demoNote: "🎭 Demo mode: no AI key set up, so this is a sample verdict",
  "trial.survived": "🛡️ The ruling held up under a tough cross-examination. Confidence stays put.",
  "trial.uncertain": "⚠️ The cross-examination raised real doubts about this ruling",
  "trial.overturned": "⚠️ The ruling didn't hold up under cross-examination",
  "trial.whatWasTested": "What got tested",
  "trial.attackPrefix": "Toughest objection:",
  "trial.refereePrefix": "Referee:",
  confidence: "Confidence {n} of {total}",
  verdictAria: "Verdict: {label}",
  "party.a": "Party A",
  "party.b": "Party B",
  "party.youLabel": "{label} (you)",
  you: "You",
  "shared.subtitle": "Someone shared this ruling",
  "shared.cta": "Settle your own argument →",
  errorFallback: "Something went wrong. Mind trying again?",
  "error.not_configured":
    "The judge isn't set up yet. Try again later.",
  "error.quota": "The judges have used up their AI quota for now. Try again in a few minutes.",
  "error.unavailable": "We can't reach the judges right now. Give it a minute and try again.",
  "error.too_short": "That's a bit thin. Tell us more about the argument.",
  "error.too_long": "That's a lot! Keep it under 6000 characters.",
  "error.invalid": "That request didn't look right.",
  "error.rate_limited": "Order in the court! You've hit the limit for now. Try again in {wait}.",
  "error.daily_cap":
    "The court's closed for today. It's heard all the arguments it can take. Back in {wait}.",
  "error.captcha_failed": "We couldn't tell if you're human. Try the check again, then send it.",
  "wait.moment": "a few minutes",
  "wait.minute": "1 minute",
  "wait.minutes": "{n} minutes",
  "wait.hour": "1 hour",
  "wait.hours": "{n} hours",
  "refused.headline": "The AI wouldn't weigh in on this one",
  "refused.crux":
    "The AI's safety filter stopped it from judging this one. Better no verdict than a made-up one.",
  "refused.bestPoint": "Try putting it another way. Or accept that some fights are too big for an app.",
  "refused.claim": "Skipped",
  "nav.skip": "Skip to content",
  "nav.home": "Judge home page",
  "examples.label": "Stuck? Try one of these:",
  "example.hotdog.label": "🌭 Is a hot dog a sandwich?",
  "example.hotdog.text":
    "My friend Sam says a hot dog is a sandwich: it's a filling inside sliced bread, end of story. I say it's its own thing. Nobody orders a sandwich and expects a hot dog, and no menu lists it under sandwiches.",
  "example.tomato.label": "🍅 Is a tomato a fruit?",
  "example.tomato.text":
    "Alex insists a tomato is a vegetable because that's how everyone cooks and eats it. I say it's a fruit, because botanically it grows from the flower and carries the seeds.",
  "example.whiteLie.label": "🤥 Are white lies OK?",
  "example.whiteLie.text":
    "Jordan told a friend they loved her new haircut when they actually hated it, and says a white lie like that is just kindness. I think real friends should hear the truth, said gently.",
  "example.knuckles.label": "🦴 Does knuckle cracking cause arthritis?",
  "example.knuckles.text":
    "My mom says cracking my knuckles will give me arthritis. I crack them all the time and I say that's a myth with no evidence behind it.",
  "example.pineapple.label": "🍍 Pineapple on pizza?",
  "example.pineapple.text":
    "Riley says pineapple on pizza is a crime against Italian cooking. I say pizza is whatever tastes good, and tradition alone is not an argument.",
  "turnstile.label": "Quick check that you're human",
  "turnstile.error": "The human check couldn't load. Refresh the page and try again.",
  "how.title": "How it works",
  "how.kicker": "Five steps",
  "how.lead": "No coin flips. Every argument goes through the same five steps.",
  "how.step1.title": "Give both sides their best shot",
  "how.step1.body": "Each side gets put in its strongest form, even the one you think is wrong.",
  "how.step2.title": "Sort the claims",
  "how.step2.body":
    "Every claim gets tagged as fact, value, definition or logic, since each kind is settled its own way.",
  "how.step3.title": "Find the crux",
  "how.step3.body":
    "It digs under each side down to bedrock and finds the one thing the whole fight hinges on.",
  "how.step4.title": "Three independent judges",
  "how.step4.body":
    "Three judges rule separately, and a close call brings in more. Confidence comes from how much they agree, not how sure they sound.",
  "how.step5.title": "Verdict, then cross-examination",
  "how.step5.body":
    "You get the ruling and a confidence score, plus the other side's best point. A win on the facts also gets cross-examined, and if it wobbles, you get a warning.",
  "sample.title": "What a verdict looks like",
  "sample.kicker": "The result",
  "sample.lead":
    "Here's the hot dog case. Yours will also map every claim down to bedrock and list the facts it leans on.",
  "sample.badge": "Example",
  "sample.nameA": "Sam",
  "sample.nameB": "You",
  "sample.label": "You're right",
  "sample.headline": "Nobody orders a sandwich hoping for a hot dog",
  "sample.crux":
    "On shape alone a hot dog could pass as a sandwich, but that's not how anyone actually uses the word.",
  "sample.why":
    "Sam's case rests on shape alone. A word means what people use it for, and a sandwich order at any deli never comes back as a hot dog.",
  "sample.bestPoint":
    "A split roll with a filling inside does fit most dictionary definitions of a sandwich.",
  "faq.title": "Things people ask",
  "faq.kicker": "FAQ",
  "faq.fair.q": "Is it fair?",
  "faq.fair.a":
    "It tries hard to be. Names become Party A and Party B, so the judges never know who's who. Both sides get argued at their strongest, and three judges rule separately. If they disagree, the confidence score drops and tells you. On a close call, more judges get called in first. It can still be wrong, so check the facts it lists.",
  "faq.private.q": "Is my text private?",
  "faq.private.a":
    "You need an account to get a verdict. Your text goes to an outside AI service so the names can be swapped for Party A and Party B, and only that version is judged. We keep what you wrote, names included, encrypted, so you can see it again; you can have it removed any time. Share links show the names you choose, or none.",
  "faq.powers.q": "What powers it?",
  "faq.powers.a":
    "An AI model from an outside provider. Three judges run side by side on a structured judging prompt, with more joining on a close call. Winning factual rulings get their own cross-examination. The confidence math is plain code that counts how often the judges agree.",
  "faq.taste.q": "What if it's just a matter of taste?",
  "faq.taste.a":
    "Then it'll tell you: “It depends on your values” or “Same word, different meanings”. You still see which way the judges lean, clearly marked as a forced ruling.",
  "faq.legal.q": "Is this legal advice?",
  "faq.legal.a":
    "No. Judge is for fun and for thinking a bit more clearly about everyday spats. For anything legal, medical or financial, talk to a qualified human.",
  "footer.about": "About",
  "footer.privacy": "Privacy",
  "footer.home": "Settle an argument",
  "footer.note": "For fun and clarity, not legal advice.",
  "footer.language": "Language",
  "footer.nav": "Site links",
  "shared.ctaLead": "Got an argument of your own?",
  "notFound.title": "This verdict has left the courtroom",
  "notFound.body": "Maybe the link has a typo, or the verdict is gone.",
  "about.title": "About Judge",
  "about.kicker": "How we judge",
  "about.lead":
    "Judge is a small, opinionated referee for everyday arguments. Tell it what you're fighting about and it'll say who's right. Or, just as handy, why nobody is.",
  "about.honestTitle": "Honest labels",
  "about.honest":
    "Not every fight has a winner. A verdict can be a clear win, a split decision, “it depends on your values”, or “same word, different meanings”. If you still want a winner, you get a forced ruling, labeled as one.",
  "about.limitsTitle": "Limits",
  "about.limit1":
    "It only knows what you tell it, and how you tell the story shapes the result. Include the other side the way they'd put it.",
  "about.limit2":
    "AI judges can get facts wrong. Every verdict lists the facts it leans on so you can check them.",
  "about.limit3":
    "Swapping out names works most of the time, but unusual names or nicknames can slip through.",
  "about.limit4": "It's for fun and clarity, not legal, medical or financial advice.",
  "about.builtTitle": "Under the hood",
  "about.built":
    "Judge runs on an AI model from an outside provider. Three judges work in parallel and more join on a close call. How much they agree sets the confidence score, and a winning factual ruling faces its own cross-examination before it stands.",
  "privacy.title": "Privacy",
  "privacy.kicker": "Your data",
  "privacy.lead":
    "Short version: we keep what you write, names included, encrypted, so you can come back to it. The judges only ever read a version with the names taken out. You can have it removed any time. We sell nothing.",
  "privacy.storedTitle": "What we store",
  "privacy.stored":
    "For every verdict we keep your text exactly as you wrote it (with your answers to the judges' questions and the text read from any screenshots), and a list of which name became which label. These are encrypted with a key that isn't stored in the database. We also keep the anonymized version the judges read (names swapped for Party A and Party B), the settings you picked, the verdict, any translation, and the names you choose to show on the share page.",
  "privacy.notStoredTitle": "What we don't do",
  "privacy.notStored":
    "No ad trackers, and we never sell data. Your language choice lives in your browser's local storage and nowhere else.",
  "privacy.ipTitle": "Rate limiting",
  "privacy.ip":
    "To keep the court open for everyone, we cap how many verdicts each account and how many translations each visitor can ask for. For translations, and for answers to a two-sided case, we keep a keyed hash of your IP address, not the address itself, in our rate-limit store for up to 24 hours. If the human check is on, your IP address also goes to Cloudflare for that check. It's never saved with your verdict.",
  "privacy.processorsTitle": "Who else handles your text",
  "privacy.processors":
    "The text you type, real names included, first goes to our AI provider in the United States so the names can be taken out. Only the anonymized version is judged; your original is stored encrypted, as described above. If the human check is on, Cloudflare Turnstile runs in your browser and checks the result with Cloudflare. If you sign in, Apple or Google (whichever you pick) handle that sign-in, and sign-in emails go out through Resend. Our hosting provider keeps standard server logs.",
  "privacy.shareTitle": "Share links",
  "privacy.share":
    "Anyone with the link to a verdict can see it, with the display names you chose (or Party A and Party B if you switched names off). Links use long random IDs, and share pages ask search engines not to index them. A removed verdict's link and preview image stop loading; previews already posted in chat apps may keep showing until those apps refresh them. Leave out addresses, phone numbers or anything else you wouldn't want on a page others can open.",
  "privacy.contactTitle": "Contact",
  "privacy.contact":
    "Questions, or a request to see, correct or remove your data? Email {email} with the link to the verdict or case.",
  "privacy.accountsTitle": "Accounts",
  "privacy.accounts":
    "You need an account to get a verdict; the other side of a two-sided case can answer without one. If you sign in with Apple or Google, we keep the email address, name and profile picture link they share with us, plus which sign-in method you used, and Apple or Google can see that you signed in to Judge. If you sign in with an email link, that email goes out through Resend, and we briefly keep a record with your email address to check the link: it stops working after 10 minutes and is deleted once used or soon after it expires. We also keep your session records (a random token and when it expires, with no IP address or device details), your credits, your plan and its history, and which verdicts used a credit (only the verdict's ID). We also keep which verdicts and cases are yours, so you can find them on any device. Deleting your account on the account page removes all of that, and removes your verdicts and your sides of cases as described under Removal. We keep only a scrambled form of your email address, so a new account with it doesn't get a second free verdict.",
  "privacy.webSearchTitle": "Web search and questions",
  "privacy.webSearch":
    "Every verdict sends the anonymized argument to our AI provider with web search turned on. The model writes the search queries from that anonymized text, and the results come from the provider's search partner. The sources it used are shown on the verdict. The judges may first ask you up to two questions: to come up with them, your text as you typed it, names included, goes to the AI provider once more. Your answers are anonymized together with the argument before judging; the questions and your answers as you wrote them are kept with your encrypted original.",
  "nav.signIn": "Sign in",
  "nav.account": "Account",
  "nav.pricing": "Pricing",
  "nav.accountMenu": "Account menu",
  "nav.signOut": "Sign out",
  "nav.new": "New",
  "nav.verdicts": "My verdicts",
  "nav.tabs": "Sections",
  "footer.pricing": "Pricing",
  "tier.lockedSignIn": "(locked: sign in to use it)",
  "tier.getPremium": "Get more verdicts",
  "tier.checking": "Checking if anything's missing…",
  "clarify.title": "Before the judges rule",
  "clarify.lead": "These details could change who's right. Answer what you can, or skip.",
  "clarify.answerAria": "Answer to question {n}:",
  "clarify.placeholder": "Your answer (optional)",
  "clarify.skip": "Skip and judge",
  "clarify.submit": "Get the verdict",
  "clarify.back": "Edit the argument",
  "thinking.factcheck": "Checking the facts on the web…",
  "thinking.factcheckDone": "Web check finished.",
  "thinking.premiumHelper":
    "Checking the facts on the web takes a little longer. Give it a minute or two.",
  "panel.premium": "Judged with a web fact-check.",
  "panel.models": "Judges: {list}",
  "panel.strong": "{n} strong",
  "panel.quick": "{n} quick",
  "factcheck.title": "Checked on the web",
  "factcheck.lead": "The judges saw these search results before ruling. They're evidence, not the ruling itself.",
  "factcheck.status.supported": "Holds up",
  "factcheck.status.refuted": "Doesn't hold up",
  "factcheck.status.mixed": "Partly true",
  "factcheck.status.unverified": "Couldn't confirm",
  "factcheck.sources": "Sources",
  "factcheck.sourceAria": "{title}, opens in a new tab",
  "factcheck.none": "Nothing to look up on the web: this one turns on values or meanings, not facts.",
  "factcheck.noneFactual":
    "Nothing here could be checked on the web: the facts in this one are between the people involved.",
  "factcheck.unavailable": "The web check didn't finish this time, so the judges ruled without it.",
  "signin.title": "Sign in",
  "signin.lead": "Sign in to get a verdict. A new account gets its first verdict free.",
  "signin.apple": "Continue with Apple",
  "signin.google": "Continue with Google",
  "signin.emailToggle": "Use email instead",
  "signin.emailLabel": "Email address",
  "signin.emailPlaceholder": "you@example.com",
  "signin.emailSubmit": "Email me a sign-in link",
  "signin.emailSent": "Check your inbox. We sent a sign-in link to {email}. It works for 10 minutes.",
  "signin.emailInvalid": "That email address doesn't look right.",
  "signin.dev": "Continue as test user",
  "signin.devNote": "Local testing only. This button never shows on the live site.",
  "signin.unavailable": "Sign-in isn't set up on this site yet.",
  "signin.providerUnavailable": "Not available yet",
  "signin.failed": "We couldn't sign you in. Mind trying again?",
  "signin.legal": "An outside AI reads your arguments. By continuing you agree to the",
  "signin.legalLink": "Privacy Policy",
  "signin.legalAfter": ".",
  "signin.loading": "Loading sign-in options…",
  "account.title": "Your account",
  "account.signedInAs": "Signed in as {email}",
  "account.plan": "Your plan",
  "account.credits": "Credits left",
  "account.subscription": "Monthly plan",
  "account.subscriptionNone": "Not active",
  "account.subscriptionUntil": "Active until {date}",
  "account.subscriptionRenews": "Renews on {date}",
  "account.fairUse": "{used} of {cap} verdicts used this month",
  "account.getPremium": "Get more verdicts",
  "account.signOut": "Sign out",
  "account.delete": "Delete account",
  "account.deleteConfirm":
    "Delete your account? Your credits, plan and sign-in details are deleted. Your verdicts and your sides of cases are removed: what you wrote and the names are erased, and their share links stop working.",
  "account.deleteYes": "Yes, delete it",
  "account.deleteCancel": "Keep my account",
  "account.deleted": "Your account is deleted. Taking you to the home page…",
  "account.deleteFailed": "We couldn't delete the account just now. Mind trying again?",
  "account.signInPrompt": "Sign in to see your plan and credits.",
  "account.loadFailed": "We couldn't load your account. Try again in a moment.",
  "account.loading": "Loading your account…",
  "pricing.title": "Your first verdict is on us.",
  "pricing.lead":
    "Create an account and your first verdict is free, with every feature. After that, pick a pack or go monthly.",
  "pricing.titleMember": "Get more verdicts.",
  "pricing.leadMember": "Pick a pack or go monthly. Every verdict gets the full panel.",
  "pricing.included.title": "Every verdict",
  "pricing.buy.title": "Packs and the monthly plan",
  "pricing.premium.f1": "Facts checked on the web, with the sources on your verdict",
  "pricing.premium.f2": "Three AI judges and an honest confidence score, with more called in when it's close",
  "pricing.premium.f3": "Up to two quick questions when a key fact is missing",
  "pricing.premium.f4": "Names swapped out before judging",
  "pricing.packsTitle": "Credit packs",
  "pricing.packsLead": "Pay once and use them whenever. Each verdict uses one credit.",
  "pricing.pack": "{n} verdicts",
  "pricing.pack.one": "1 verdict",
  "pricing.perVerdict": "{price} per verdict",
  "pricing.monthly.title": "Monthly plan",
  "pricing.monthly.renews": "Renews every month",
  "pricing.monthly.cap": "{n} verdicts a month",
  "pricing.comingSoon": "Coming soon",
  "pricing.note": "Prices are in US dollars. Payments aren't open yet, so nothing can be bought today.",
  "pricing.signIn": "Create an account for your free verdict",
  "pricing.preview": "Verdicts aren't switched on here yet. This page is a preview.",
  "error.signin_required": "Sign in to continue.",
  "error.premium_required": "Verdicts need credits or the monthly plan.",
  "error.no_credits": "You're out of verdicts. Pick a pack or go monthly on the Pricing page.",
  "error.fair_use": "You've used this month's verdicts. More on {date}.",
  "error.fair_useSoon": "You've used this month's verdicts. More soon.",
  "error.in_progress": "That verdict is still being worked on. Give it a moment.",
  "error.bad_origin": "That request came from somewhere we don't recognize. Reload the page and try again.",
  "error.not_found": "We couldn't find that.",
  "error.case_closed": "This case isn't taking that anymore.",
  "error.case_expired": "This invite has expired.",
  "error.appeal_used": "You've already added context to this case.",
  "error.appeal_limit": "You've added context to this verdict twice. That's as many times as one verdict takes.",
  "error.not_party": "Only the people in this case can do that.",
  "error.own_case": "This is your own invite. Send the link to the other person.",
  "error.too_large": "That's too big. Try a smaller image.",
  "error.unsupported_media": "We can only read PNG, JPEG, WebP or GIF images.",
  "error.too_many_files": "That's more images than you can add here.",
  "error.evidence_invalid": "One of your images expired or couldn't be checked. Remove it and add it again.",
  "error.anonymize_failed": "We couldn't take the names out of your text. Try again, or write initials instead of full names.",
  // --- Two-sided cases, evidence and appeals ---
  "mode.label": "How should we judge it?",
  "mode.now": "Just me (instant)",
  "mode.both": "Both sides (send a link)",
  "mode.nowHint": "You tell it, and the judges rule right away.",
  "mode.bothHint":
    "We'll give you a private link. They tell their side; neither of you sees the other's until the verdict.",
  "mode.signIn": "Sign in to send a link",
  "case.create": "Create the invite",
  "case.creating": "Anonymizing your side…",
  "case.kicker": "Both sides",
  "case.kickerOneSided": "Your side only",
  "case.title": "Your case",
  "case.loading": "Loading the case…",
  "case.loadFailed": "We couldn't load this case. Try again in a moment.",
  "case.notFound": "We couldn't find this case. It may have been deleted, or it belongs to another account.",
  "case.signIn": "Sign in to see your case.",
  "case.status.awaiting": "Waiting for the other side",
  "case.status.judging": "The judges are on it",
  "case.status.judged": "Verdict",
  "case.status.failed": "The judges couldn't finish",
  "case.status.expired": "The invite expired",
  "case.invite.label": "Send this link to the other person",
  "case.invite.copy": "Copy link",
  "case.invite.copied": "Copied",
  "case.invite.share": "Share",
  "case.invite.shareText": "I asked Judge to settle our argument. Tell your side here. I won't see it until the verdict.",
  "case.invite.reset": "Make a new link",
  "case.invite.resetConfirm": "The link you already sent will stop working. Make a new one?",
  "case.invite.resetYes": "Yes, make a new link",
  "case.invite.resetDone": "Old link turned off. Send the new one.",
  "case.invite.expires": "The link works until {date}.",
  "case.invite.expiresSoon": "The link works for 7 days.",
  "case.held": "1 verdict is held for this case. You get it back if nobody answers by {date}.",
  "case.heldSoon": "1 verdict is held for this case. You get it back if nobody answers within 7 days.",
  "case.judgeNow": "Judge with only my side",
  "case.judgeNow.confirm": "Get a one-sided verdict now? The invite closes and they can't answer anymore.",
  "case.judgeNow.yes": "Yes, judge it now",
  "case.judgeExpired.confirm": "Get a verdict on your side alone? This uses 1 verdict.",
  "case.judgeExpired.yes": "Yes, use 1 verdict",
  "case.cancel": "Cancel",
  "case.retry": "Try again",
  "case.failedBody": "Your credit is back. You can try again now.",
  "case.failedBodyFree": "Something went wrong on our side. Trying again uses 1 verdict.",
  "case.yourSide": "Your side, as the judges read it",
  "case.accounts": "What each side told the judges",
  "case.accountA": "Party A's account",
  "case.accountB": "Party B's account",
  "case.accountYou": "Your account ({label})",
  "case.contextA": "Party A added context",
  "case.contextB": "Party B added context",
  "case.contextYou": "Context you added ({label})",
  "case.evidenceItem": "Image {n}, as the judges read it",
  "case.notYet": "They haven't answered yet.",
  "case.answered": "They answered. The judges are working on it.",
  "case.judgingAlone": "The judges are working on your side.",
  "case.expiredBody":
    "Nobody answered in 7 days, so your credit is back. You can still get a verdict on your side alone.",
  "case.expiredBodyFree": "Nobody answered in 7 days. You can still get a verdict on your side alone.",
  "case.oneSided": "Judged on your side only.",
  "case.startOver": "Start a new case",
  "case.list.title": "Your cases",
  "case.list.empty": "No cases yet.",
  "case.list.loadFailed": "We couldn't load your cases just now.",
  "case.list.started": "Started {date}",
  "case.list.untitled": "Case from {date}",
  "case.list.untitledSoon": "Case",
  "respond.kicker": "Your side",
  "respond.title": "Tell your side",
  "respond.intro":
    "Someone asked Judge to settle an argument with you. Tell your side; they won't see it until the verdict.",
  "respond.privacy":
    "Names are swapped for Party A and Party B before the judges read anything. You don't need an account.",
  "respond.lang": "The verdict will be written in {lang}.",
  "respond.lang.en": "English",
  "respond.lang.tr": "Turkish",
  "respond.label": "Your side",
  "respond.placeholder": "What happened, from where you stand? Write it the way you'd tell a friend.",
  "respond.submit": "Send my side",
  "respond.sent": "Thanks. Your side is in and the judges are on it.",
  "respond.ownInvite": "This is your own invite link. Send it to the other person.",
  "respond.expired": "This invite has expired.",
  "respond.closed": "This case isn't taking answers anymore.",
  "respond.withoutYou": "This case was settled without your side.",
  "respond.failed": "The judges couldn't finish this one. The person who invited you can try again.",
  "respond.notFound": "This invite link doesn't work. It may have been turned off, or part of it is missing.",
  "respond.loading": "Opening the invite…",
  "respond.inviteTitle": "This invite",
  "respond.startOwn": "Got an argument of your own to settle?",
  "respond.startOwnCta": "Start one",
  "respond.pendingMissing": "Open the invite link again to carry on.",
  "evidence.label": "Screenshots (optional)",
  "evidence.add": "Add screenshots",
  "evidence.addOne": "Add a screenshot",
  "evidence.hint": "Up to {n} images. We read the text, hide the names, and never keep the images.",
  "evidence.hintOne": "One image. We read the text, hide the names, and never keep the image.",
  "evidence.reading": "Reading…",
  "evidence.ok": "Read",
  "evidence.remove": "Remove image {n}",
  "evidence.thumb": "Image {n}",
  "evidence.preview": "What we read",
  "evidence.previewNote": "Only you see this. Names are hidden before the judges read it.",
  "evidence.status.unreadable": "Couldn't read any text",
  "evidence.status.refused": "The reader declined this image",
  "evidence.status.unsupported": "Not a PNG, JPEG, WebP or GIF",
  "evidence.status.too_large": "Too big",
  "evidence.status.failed": "Couldn't read it, try again",
  "evidence.limit": "That's the most images you can add here.",
  "evidence.used": "Evidence: {a} from Party A, {b} from Party B",
  "evidence.usedOne": "Images the judges read: {n}",
  "twoSided.badge": "Both sides heard",
  "twoSided.agreed": "What both agree on",
  "twoSided.disputed": "What they dispute",
  "twoSided.finding.a": "Leans toward {name}",
  "twoSided.finding.b": "Leans toward {name}",
  "twoSided.finding.self": "Leans your way",
  "twoSided.finding.unsettled": "Unsettled",
  "twoSided.decisive": "The verdict hinges on this",
  "twoSided.wouldChange": "What would change this verdict",
  "appeal.title": "Add context",
  "appeal.lead":
    "Something missing or wrong? Add it once and the judges look at everything again. Costs 1 verdict.",
  "appeal.label": "Your context",
  "appeal.placeholder": "What did the judges miss?",
  "appeal.submit": "Re-judge with my context",
  "appeal.sending": "Anonymizing your context…",
  "appeal.judging": "The judges are looking at everything again…",
  "appeal.upsell": "Something missing? Add context and have it re-judged for 1 verdict.",
  "appeal.signIn": "Sign in to add context",
  "appeal.used": "You've already added context to this case.",
  "appeal.limit": "You've added context twice. That's the limit for one verdict.",
  "appeal.busy": "The judges are re-judging right now.",
  "appeal.outcome.upheld": "Verdict stands",
  "appeal.outcome.overturned": "Verdict flipped",
  "appeal.outcome.changed": "Verdict changed",
  "appeal.by": "After new context from {name}",
  "appeal.bySelf": "After your new context",
  "appeal.generic.upheld": "The new context didn't change the outcome.",
  "appeal.generic.overturned": "The new context flipped the outcome.",
  "appeal.generic.changed": "The new context changed the verdict.",
  "appeal.previous": "Earlier verdict",
  "appeal.failed": "The re-judge didn't go through. Your credit is back; you can try again.",
  "appeal.refused": "The judges wouldn't re-judge with that context. Your credit is back.",
  "appeal.leadVerdict":
    "Something missing or wrong? Add it and the judges look at everything again. Each time costs 1 verdict, up to twice per verdict.",
  "appeal.history": "Verdict history",
  "faq.both.q": "Can the other person tell their side?",
  "faq.both.a":
    "Yes, once you sign in. Pick “Both sides” and you get a private link to send them. They write their side without an account, and neither of you sees the other's text until the verdict. You can get a verdict on your side alone at any time, and the link stops working after 7 days.",
  "faq.both.premium":
    "The case uses 1 verdict, which comes back if they don't answer. After the verdict each of you can add context once and have it re-judged (1 verdict).",
  "faq.evidence.q": "Can I add screenshots?",
  "faq.evidence.a":
    "Yes, up to three per side, like a chat or a receipt. Each image goes to an outside AI service once so its text can be read. The judges see a version with the names hidden. We keep the text read from the image, encrypted, with your original; the image itself is never stored. Screenshots can be cropped or out of context, so the judges treat them as strong evidence, not proof.",
  "about.casesTitle": "Hearing both sides",
  "about.cases1":
    "Two-sided cases: sign in, write your side and send a private link. The other person writes theirs without seeing yours, and the judges weigh both accounts: what they agree on, what they dispute, and what evidence would change the verdict.",
  "about.cases2": "If nobody answers within 7 days, the link stops working. You can still get a verdict on your side alone.",
  "about.premiumTitle": "Extras",
  "about.premium2":
    "Evidence: add screenshots of chats or documents. We read the text in them, hide the names and throw the image away.",
  "about.premium3":
    "Appeals: after a verdict, each person can add context once. The judges look at everything again and say whether the verdict stands, flipped or changed. Earlier verdicts stay viewable.",
  "about.premium4":
    "A two-sided case uses 1 verdict. It is held when you send the link and comes back if nobody answers within 7 days.",
  "privacy.casesTitle": "Two-sided cases and appeals",
  "privacy.cases":
    "In a two-sided case, each side is anonymized when it's sent, the same way as a verdict. The anonymized text is what the judges read; each person's side as they wrote it, with its list of names, is stored encrypted, and only that person can see it. Each person types the name they want shown on the share page when they send their side; left empty, it's Party A or Party B. The other person needs no account; their answers are rate-limited with a keyed hash of their IP address. The invite link is stored only as a hash. If the other person answers while signed in, their account is linked to their side, so only they can add context later or see their original; if they answer signed out, a private code kept in their browser does the same. To give the same person the same label in both accounts, the server keeps coded fingerprints of names inside each case (keyed hashes, not the names themselves). Until the verdict, neither side can read the other's text; after a two-sided verdict, both people can read both anonymized accounts. Context added after a verdict (an appeal) is handled the same way. When the other person answers, we may email you a short note without any case text, if email is set up. Either person can remove their own side: their original and display name are erased, and the case's share links stop working for everyone. Deleting your account does this for every case you started or answered.",
  "privacy.evidenceTitle": "Screenshots",
  "privacy.evidence":
    "Your browser shrinks large images before uploading them. Each image then goes to an outside AI service once so the visible text can be read; we never store the image. The raw transcript, which can still contain names, comes back to you inside a signed token your browser holds for up to 6 hours. When you send your side, the transcript is anonymized together with your text: the anonymized transcript is shown to the judges and stored with the case, and the raw transcript is kept encrypted with your original, where only you can see it. Phone numbers, e-mail addresses, social media handles and account numbers in it are replaced with placeholders for the judges too.",
  "pricing.premium.f5": "Screenshot evidence, read and then thrown away, at no extra cost",
  "pricing.premium.f6": "Add context after a verdict and get it re-judged (1 verdict)",
  "pricing.premium.f7": "Hear both sides: send the other person a private link to tell theirs",
  // Intentionally language-invariant: each aria label is written in the
  // language of the audience it serves (the TR side speaks to Turkish
  // readers, the EN side to English readers), whatever the current lang.
  "langToggle.toTr": "Türkçeye geç",
  "langToggle.toEn": "Switch to English",
  "shared.subtitleHidden": "Someone shared this ruling · names hidden",
  "shared.ownKicker": "Your verdict",
  "removed.title": "This verdict was removed",
  "removed.body": "Its share link no longer works.",
  "error.removed": "This was removed. Its link no longer works.",
  "error.names_unavailable": "Names can't be saved right now. Try again later.",
  "verdict.remove": "Remove this verdict",
  "verdict.remove.confirm":
    "Remove what you wrote, the names and the display names? The share link and its preview image stop loading for everyone (previews already posted in chats may still show until those apps refresh them). This can't be undone.",
  "verdict.remove.yes": "Yes, remove it",
  "verdict.removed": "Removed. The link no longer works.",
  "verdict.removeFailed": "We couldn't remove it just now. Mind trying again?",
  "case.remove": "Remove this case",
  "case.remove.confirm":
    "Remove your original text, the names and your display name from this case? The case's share links stop working for everyone (previews already posted in chats may still show until those apps refresh them). This can't be undone.",
  "case.remove.yes": "Yes, remove it",
  "case.removed": "This case was removed.",
  "case.removedBanner": "This case was removed. Its links no longer work.",
  "case.sideRemoved": "Removed at this person's request.",
  "case.originalTitle": "Your side as you wrote it",
  "case.appealOriginal": "Your added context as you wrote it",
  "case.displayName": "Your name on the shared verdict",
  "case.displaySave": "Save name",
  "respond.remove": "Remove my side",
  "respond.remove.confirm":
    "Remove your original text and your display name? The case's share links stop working (previews already posted in chats may still show until those apps refresh them). This can't be undone.",
  "names.title": "Names on the shared page",
  "names.you": "Your name",
  "names.show": "Show names on the shared page",
  "names.save": "Save",
  "names.saveShare": "Save and share",
  "names.edit": "Edit names",
  "names.saved": "Names saved.",
  "names.failed": "We couldn't save the names. Try again.",
  "names.invalid": "Use 1 to 40 characters, and not a label such as Party A.",
  "owner.original": "What you wrote",
  "owner.answers": "Your answers to the questions",
  "owner.extras": "Your answers and screenshots",
  "owner.skipped": "(skipped)",
  "owner.evidence": "Text read from your screenshots",
  "owner.notStored": "What you wrote isn't stored for this verdict.",
  "owner.unreadable": "What you wrote can't be shown right now.",
  "owner.claim": "Keep this verdict in your account",
  "owner.claimed": "This verdict is in your account now.",
  "owner.case": "This verdict belongs to a case. Change its names or remove it on the case page.",
  "owner.caseRespondent":
    "This verdict belongs to a case you answered. To change your name or remove your side, open the invite link you answered from.",
  "owner.caseLink": "Open the case",
  "account.verdicts.title": "Your verdicts",
  "account.verdicts.empty": "No verdicts yet.",
  "account.verdicts.loadFailed": "We couldn't load your verdicts.",
  "account.verdicts.removed": "Removed",
  "shell.history": "History",
  "shell.new": "New argument",
  "shell.today": "Today",
  "shell.week": "This week",
  "shell.earlier": "Earlier",
  "shell.empty": "Your verdicts will show up here.",
  "shell.loading": "Loading your history…",
  "shell.loadFailed": "We couldn't load your history.",
  "shell.loadMore": "Show more",
  "shell.untitled": "Untitled verdict",
  "shell.local": "These are saved in this browser only.",
  "shell.localSignIn": "Sign in to see your verdicts on any device",
  "shell.case.waiting": "Waiting for reply",
  "shell.case.judging": "Being judged",
  "shell.case.judged": "Judged",
  "shell.case.failed": "Didn't finish",
  "shell.case.expired": "Expired",
  "thread.label": "This argument",
  "thread.you": "You wrote",
  "thread.judges": "The judges",
  "thread.placeholder": "What's the argument? Who says what, and why?",
  "thread.placeholderTwoSided": "What happened, from where you stand?",
  "thread.options": "Options",
  "thread.judgesAgree": "Judges · {n} of {total} agree",
  "thread.judgesSplit": "Judges · split",
  "home.kicker": "New case",
  "home.title": "State your case.",
  "home.step.argument": "The argument",
  "home.step.ruling": "Ruling",
  "home.invite": "Or invite the other side to tell theirs",
  "home.oneSide": "Judge just my side instead",
  "home.left.one": "1 verdict left",
  "home.left.other": "{n} verdicts left",
  "home.monthLeft": "{n} of {cap} left this month",
  "home.out": "No verdicts left.",
  "home.pricing": "See pricing",
  "verdict.noMajority": "Judges split",
  "stamp.split": "Split",
  "stamp.conditional": "Conditional",
  "stamp.tooClose": "Too close",
  "stamp.dissolved": "Dissolved",
  "bestPoint.of": "{name}'s best point",
  "bestPoint.self": "Your best point",
  "privacy.accessTitle": "Who can see what",
  "privacy.access":
    "You: your original text and names, on any device when you're signed in, or on the device you used through a private code saved in your browser or the app (we only keep a scrambled form of that code). Verdicts written signed out, before an account was needed, stay listed in that browser with their headlines and your names as you wrote them, so My verdicts can show them: anyone using the same browser sees that list. On a shared computer, sign in or use a private window; clearing the site's data in the browser removes the list. In a two-sided case each person sees only their own original; after the verdict both see both anonymized accounts, as the judges read them. The judges (AI models run by our AI provider): only the anonymized version. Anyone with the share link: the verdict with display names. By default that's the name you choose for yourself and the first names of the others as you wrote them; you can change them or switch names off at any time, and then the page shows Party A and Party B. Us: we can decrypt originals with the key, and only do so to answer your requests, fix problems, or when the law requires it.",
  "privacy.removalTitle": "Removal",
  "privacy.removal":
    "Ask for removal on the verdict page (signed in, you can open it from your account page), on the case page for a two-sided case, by deleting your account, or by email. Removal erases your original text, the name list and the display names (in a two-sided case, your side's original and your display name), and the share link and its preview image stop loading for everyone. Previews already posted in chat apps are kept by those apps and may keep showing until they refresh them. We keep the anonymized text and the verdict, without names, in our records; they can no longer be opened through the link. Deleting your account does this for all your verdicts and your sides of cases, and deletes your sign-in details, credits and plan. Removed data stays in our backups until they expire (at most 14 days, see below); if we ever restore a backup, we apply every removal again (for that we keep a list of what was removed and when, with no text or names).",
  "privacy.retentionTitle": "How long we keep it",
  "privacy.retention":
    "We keep verdicts and originals until you ask for removal or delete your account. To recover from a failure, we keep backup copies of the server and its database for up to 14 days, then they're deleted. They hold the same data as the server, including the encrypted originals, and the key is on the same server, so the backups are protected like the server itself, not by that encryption. Rate-limit hashes last up to 24 hours. Server logs follow our hosting provider's standard retention.",
  "privacy.locationTitle": "Where your data is",
  "privacy.location":
    "Our servers are in Germany (OVH, Frankfurt). Some processing happens in the United States: our AI provider runs the models that remove names, judge, read screenshots and search the web; Cloudflare sits in front of okjudge.com as proxy and DNS (all traffic passes through it) and runs the human check. Sign-in goes through Apple or Google if you pick them, and sign-in emails through Resend. Data handled in another country can be subject to that country's laws.",
  "privacy.rightsTitle": "Your rights (Canada)",
  "privacy.rights":
    "Judge is run from Canada and handles personal information under Canada's federal privacy law (PIPEDA): we collect only what the service needs, use it only for that, protect it, and you can ask to see, correct or remove what we hold about you. We answer within 30 days.",
} as const;

export type Key = keyof typeof en;

/** A translation of the interface, one file per language under lib/locales. */
export type Locale = {
  /** Every key of the English table, nothing else. */
  strings: Record<Key, string>;
};

export const STRINGS = { en, tr: tr.strings } as const;

const TABLES: Partial<Record<Lang, Record<Key, string>>> = STRINGS;

/** Look up a string and interpolate `{var}` slots. Unknown braces are left
 * alone. A language without strings reads English. */
export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s: string = (TABLES[lang] ?? en)[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/** Claim-kind tag labels, shared by ArgumentMap and the judging checklist. */
export const KIND_KEY = {
  fact: "kind.fact",
  value: "kind.value",
  definition: "kind.definition",
  logic: "kind.logic",
} as const satisfies Record<ClaimKind, Key>;

/**
 * API error `code` → dictionary key. The route sends a stable machine code
 * alongside its English `error` text; the client localizes from the code.
 */
export const ERROR_KEY_BY_CODE: Partial<Record<string, Key>> = {
  invalid: "error.invalid",
  too_short: "error.too_short",
  too_long: "error.too_long",
  not_configured: "error.not_configured",
  quota: "error.quota",
  unavailable: "error.unavailable",
  rate_limited: "error.rate_limited",
  daily_cap: "error.daily_cap",
  captcha_failed: "error.captcha_failed",
  signin_required: "error.signin_required",
  premium_required: "error.premium_required",
  no_credits: "error.no_credits",
  fair_use: "error.fair_use",
  in_progress: "error.in_progress",
  bad_origin: "error.bad_origin",
  not_found: "error.not_found",
  case_closed: "error.case_closed",
  case_expired: "error.case_expired",
  appeal_used: "error.appeal_used",
  appeal_limit: "error.appeal_limit",
  not_party: "error.not_party",
  own_case: "error.own_case",
  too_large: "error.too_large",
  unsupported_media: "error.unsupported_media",
  too_many_files: "error.too_many_files",
  evidence_invalid: "error.evidence_invalid",
  anonymize_failed: "error.anonymize_failed",
  removed: "error.removed",
  names_unavailable: "error.names_unavailable",
};

/** Keys whose `{date}` slot has a whole-sentence fallback for when the
 * server sent no usable date, so a raw `{date}` never reaches the reader. */
const DATELESS_KEY: Partial<Record<Key, Key>> = {
  "error.fair_use": "error.fair_useSoon",
  "case.invite.expires": "case.invite.expiresSoon",
  "case.held": "case.heldSoon",
  "case.list.untitled": "case.list.untitledSoon",
};

/** An ISO timestamp as a short calendar date ("November 18" / "18 Kasım").
 * Null for missing or unparseable input. Intl only: no DOM, so the mobile
 * app can reuse it. */
export function formatDate(lang: Lang, iso: unknown): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(langTag(lang), {
    month: "long",
    day: "numeric",
  }).format(d);
}

/** `t()` for a string with a `{date}` slot: falls back to its dateless
 * sibling when `iso` is not a usable date. */
export function tWithDate(lang: Lang, key: Key, iso: unknown): string {
  const date = formatDate(lang, iso);
  if (date === null) {
    const fallback = DATELESS_KEY[key];
    if (fallback) return t(lang, fallback);
  }
  return t(lang, key, { date: date ?? "" });
}

/** A server-provided wait (seconds) as a whole human phrase: minutes below
 * 90, hours beyond. Always rounds UP so "try again in 1 minute" never
 * undersells the wait. Missing or nonsense input reads as "a few minutes". */
export function formatWait(lang: Lang, seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return t(lang, "wait.moment");
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) {
    return minutes === 1 ? t(lang, "wait.minute") : t(lang, "wait.minutes", { n: minutes });
  }
  const hours = Math.ceil(seconds / 3600);
  return hours === 1 ? t(lang, "wait.hour") : t(lang, "wait.hours", { n: hours });
}

/**
 * Localized message for a failed POST /api/verdict. `body` is whatever the
 * response parsed to (null when it was not JSON); `status` lets a bare 429
 * from the hosting layer still read as a rate limit. Unknown codes fall back
 * to the server's English `error` text, then to the generic fallback.
 */
export function apiErrorMessage(lang: Lang, body: unknown, status?: number): string {
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const code = typeof b.code === "string" ? b.code : status === 429 ? "rate_limited" : undefined;
  const key = code !== undefined ? ERROR_KEY_BY_CODE[code] : undefined;
  if (key !== undefined && key in DATELESS_KEY) return tWithDate(lang, key, b.resetsAt);
  if (key !== undefined) return t(lang, key, { wait: formatWait(lang, b.retryAfterSec) });
  if (typeof b.error === "string" && b.error.trim()) return b.error;
  return t(lang, "errorFallback");
}

/**
 * Best-effort language of verdict TEXT from the text alone. New verdicts
 * record their language (`VerdictResult.lang`, read via `verdictLang`);
 * this heuristic covers rows stored before that and places that only have
 * a headline and crux, such as link-preview images fetched by crawlers.
 * Turkish-only letters or the Turkish party label decide it.
 */
export function contentLang(text: string): Lang {
  return /[ğıİşĞŞ]|\bTaraf [AB]\b/.test(text) ? "tr" : "en";
}
