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

export type Lang = "en" | "tr";

const en = {
  "hero.title": "Who's right? Settle it.",
  "hero.titleLine1": "Who's right?",
  "hero.titleLine2": "Settle it.",
  "hero.eyebrow": "Three independent judges · Judges never see names",
  "hero.lead":
    "Tell us what the fight is about. Three AI judges each make the call on their own, and the confidence score shows how much they agree.",
  "input.label": "The argument",
  placeholder:
    "What happened? Who says what, and why?\n\nPut the other person's side the way they'd say it. The judges build the strongest case for both sides either way.",
  getVerdict: "Get the verdict",
  privacyNote:
    "We swap names for Party A and Party B before judging, so the judges never know who's who.",
  judgeBy: "Judge by",
  fineTune: "Fine-tune ▸",
  hideFineTune: "Hide fine-tuning",
  sliderNote: "Middle means neutral. These only kick in when it comes down to values.",
  "preset.balanced.label": "Balanced",
  "preset.balanced.blurb": "Common-sense mix",
  "preset.outcomes.label": "Outcomes",
  "preset.outcomes.blurb": "Results matter most",
  "preset.principles.label": "Principles",
  "preset.principles.blurb": "Rules & rights first",
  "preset.fairness.label": "Fairness",
  "preset.fairness.blurb": "Same rules for everyone",
  "preset.loyalty.label": "Loyalty",
  "preset.loyalty.blurb": "People before rules",
  "slider.freedom_safety.left": "Freedom",
  "slider.freedom_safety.right": "Safety",
  "slider.individual_group.left": "Individual",
  "slider.individual_group.right": "Group",
  "slider.head_heart.left": "Head",
  "slider.head_heart.right": "Heart",
  "slider.aria": "{left} versus {right}",
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
  "trial.uncertain": "⚠️ The cross-examination raised real doubts, so confidence is capped",
  "trial.overturned": "⚠️ The ruling didn't hold up under cross-examination, so confidence is capped",
  "trial.whatWasTested": "What got tested",
  "trial.attackPrefix": "Toughest objection:",
  "trial.refereePrefix": "Referee:",
  "confidence.1": "Very low",
  "confidence.2": "Low",
  "confidence.3": "Moderate",
  "confidence.4": "High",
  "confidence.5": "Very high",
  confidenceWord: "{word} confidence · {n}/5",
  confidenceAria: "Confidence {n} of 5",
  verdictAria: "Verdict: {label}",
  "party.a": "Party A",
  "party.b": "Party B",
  you: "You",
  "shared.subtitle": "Someone shared this ruling · names hidden",
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
  "nav.how": "How it works",
  "nav.primary": "Main",
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
  "advanced.summary": "Advanced: value settings",
  "advanced.current": "Now: {label}",
  "turnstile.label": "Quick check that you're human",
  "turnstile.error": "The human check couldn't load. Refresh the page and try again.",
  privacyLink: "What happens to your text",
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
    "You get the ruling and a confidence score, plus the other side's best point. A win on the facts also gets cross-examined, and if it wobbles, the confidence drops.",
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
  "sample.bestPoint":
    "A split roll with a filling inside does fit most dictionary definitions of a sandwich.",
  "faq.title": "Things people ask",
  "faq.kicker": "FAQ",
  "faq.fair.q": "Is it fair?",
  "faq.fair.a":
    "It tries hard to be. Names become Party A and Party B, so the judges never know who's who. Both sides get argued at their strongest, and three judges rule separately. If they disagree, the confidence score drops and tells you. On a close call, more judges get called in first. It can still be wrong, so check the facts it lists.",
  "faq.private.q": "Is my text private?",
  "faq.private.a":
    "Free verdicts need no account. Your text, names and all, goes to Anthropic's API once so the names can be swapped for Party A and Party B. Only that anonymized version gets judged, and only that version is saved, so your share link works. Leave out anything you wouldn't want on a shareable page.",
  "faq.powers.q": "What powers it?",
  "faq.powers.a":
    "Anthropic's Claude. Three judges run side by side on a structured judging prompt, with more joining on a close call. Winning factual rulings get their own cross-examination. The confidence math is plain code that counts how often the judges agree.",
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
  "about.methodTitle": "The method",
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
    "Judge runs on Anthropic's Claude. Three judges work in parallel and more join on a close call. How much they agree sets the confidence score, and a winning factual ruling faces its own cross-examination before it stands.",
  "privacy.title": "Privacy",
  "privacy.kicker": "Your data",
  "privacy.lead": "Short version: accounts are optional, real names in your arguments are never kept, and we sell nothing.",
  "privacy.storedTitle": "What we store",
  "privacy.stored":
    "When you get a verdict, we save the anonymized argument (names swapped for Party A and Party B), the value settings you picked and the verdict itself, so the share link keeps working. The real names you typed are never saved. They only go back to your own browser to label the result. If someone opens it in the other language, we also save that translated copy.",
  "privacy.notStoredTitle": "What we don't do",
  "privacy.notStored":
    "No ad trackers, and we never sell data. Free verdicts need no account at all. Your language choice and your Free or Premium pick live in your browser's local storage and nowhere else.",
  "privacy.ipTitle": "Rate limiting",
  "privacy.ip":
    "To keep the court open for everyone, we cap how many verdicts and translations one visitor can ask for. For that we keep a keyed hash of your IP address, not the address itself, in our rate-limit store for up to 24 hours. If the human check is on, your IP address also goes to Cloudflare for that check. It's never saved with your verdict. Premium verdicts are also counted per account, for the same reason.",
  "privacy.processorsTitle": "Who else handles your text",
  "privacy.processors":
    "The text you type, real names included, first goes to Anthropic's API (Claude) so the names can be taken out. Only the anonymized version is then judged and stored. If the human check is on, Cloudflare Turnstile runs in your browser and checks the result with Cloudflare. If you sign in, Apple or Google (whichever you pick) handle that sign-in, and sign-in emails go out through Resend. Our hosting provider keeps standard server logs.",
  "privacy.shareTitle": "Share links",
  "privacy.share":
    "Anyone with the link to a verdict can see it. Links use long random IDs, and share pages ask search engines not to index them. So leave out addresses, phone numbers or anything else you wouldn't want on a public page.",
  "privacy.contactTitle": "Contact",
  "privacy.contact": "Got a question, or want a verdict taken down? Email {email} with the link.",
  "privacy.accountsTitle": "Accounts (optional)",
  "privacy.accounts":
    "You only need an account for Premium. If you sign in with Apple or Google, we keep the email address, name and profile picture link they share with us, plus which sign-in method you used, and Apple or Google can see that you signed in to Judge. If you sign in with an email link, that email goes out through Resend, and we briefly keep a record with your email address to check the link: it stops working after 10 minutes and is deleted once used or soon after it expires. We also keep your session records (a random token and when it expires, with no IP address or device details), your credits, your plan and its history, and which premium verdicts used a credit (only the verdict's ID). Deleting your account on the account page removes all of that. Verdicts you shared stay up as anonymous links, since they never carried your name.",
  "privacy.webSearchTitle": "Premium: web search and questions",
  "privacy.webSearch":
    "A Premium verdict sends the anonymized argument to Anthropic with web search turned on. The model writes the search queries from that anonymized text, and the results come from Anthropic's search provider. The sources it used are shown on the verdict. Premium may first ask you up to two questions: to come up with them, your text as you typed it, names included, goes to Anthropic once more and isn't stored. Your answers are anonymized together with the argument before judging, and only that anonymized version is saved.",
  "nav.signIn": "Sign in",
  "nav.account": "Account",
  "nav.pricing": "Pricing",
  "nav.accountMenu": "Account menu",
  "nav.signOut": "Sign out",
  "footer.pricing": "Pricing",
  "tier.label": "How to judge it",
  "tier.free": "Free",
  "tier.premium": "Premium",
  "tier.freeHint": "Three judges, same as always.",
  "tier.premiumHint": "Facts checked on the web with sources, a stronger panel, and a quick question if something's missing.",
  "tier.signInToUse": "Sign in to use Premium",
  "tier.lockedSignIn": "(locked: sign in to use it)",
  "tier.lockedNoAllowance": "(locked: needs credits or the monthly plan)",
  "tier.getPremium": "Get Premium",
  "tier.creditsLeft.one": "1 premium verdict left.",
  "tier.creditsLeft.other": "{n} premium verdicts left.",
  "tier.monthlyLeft": "{n} left this month.",
  "tier.invite": "Want the facts checked on the web too? Premium does that.",
  "tier.outOfCredits": "You're out of premium verdicts. Free works the same as always.",
  "tier.fairUse": "You've used this month's premium verdicts. More on {date}.",
  "tier.fairUseSoon": "You've used this month's premium verdicts. More soon.",
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
    "A stronger panel plus a web fact-check takes a little longer. Give it a minute or two.",
  "premium.badge": "Premium",
  "panel.premium": "Premium panel with a web fact-check.",
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
  "factcheck.unavailable": "The web check didn't finish this time, so the judges ruled without it.",
  "signin.title": "Sign in",
  "signin.lead": "You only need an account for Premium. Free verdicts never ask for one.",
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
  "account.plan.free": "Free",
  "account.plan.premium": "Premium",
  "account.credits": "Premium credits left",
  "account.subscription": "Monthly plan",
  "account.subscriptionNone": "Not active",
  "account.subscriptionUntil": "Active until {date}",
  "account.subscriptionRenews": "Renews on {date}",
  "account.fairUse": "{used} of {cap} premium verdicts used this month",
  "account.getPremium": "Get Premium",
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
  "account.verdicts.title": "Your verdicts",
  "account.verdicts.empty": "No verdicts yet.",
  "account.verdicts.loadFailed": "We couldn't load your verdicts.",
  "account.verdicts.removed": "Removed",
  "pricing.title": "Free, or a little extra",
  "pricing.lead":
    "Free stays free. Premium adds facts checked on the web, a stronger judge panel and quick questions when something's missing.",
  "pricing.free.title": "Free",
  "pricing.free.price": "Always free",
  "pricing.free.f1": "Three independent judges and an honest confidence score",
  "pricing.free.f2": "Names swapped out before judging",
  "pricing.free.f3": "No account needed",
  "pricing.premium.title": "Premium",
  "pricing.premium.f1": "Facts checked on the web, with the sources on your verdict",
  "pricing.premium.f2": "A stronger judge panel with Claude Sonnet",
  "pricing.premium.f3": "Up to two quick questions when a key fact is missing",
  "pricing.packsTitle": "Credit packs",
  "pricing.packsLead": "Pay once and use them whenever. One premium verdict uses one credit.",
  "pricing.pack": "{n} premium verdicts",
  "pricing.perVerdict": "{price} per verdict",
  "pricing.monthly.title": "Monthly plan",
  "pricing.monthly.renews": "Renews every month",
  "pricing.monthly.cap": "Up to {n} premium verdicts a month",
  "pricing.comingSoon": "Coming soon",
  "pricing.note": "Prices are in US dollars. Payments aren't open yet, so nothing can be bought today.",
  "pricing.signIn": "Sign in for Premium",
  "pricing.preview": "Premium isn't switched on here yet. This page is a preview.",
  "error.signin_required": "Sign in to use Premium.",
  "error.premium_required": "Premium verdicts need credits or the monthly plan.",
  "error.no_credits": "You're out of premium credits. Free verdicts still work.",
  "error.fair_use": "You've used this month's premium verdicts. More on {date}.",
  "error.fair_useSoon": "You've used this month's premium verdicts. More soon.",
  "error.in_progress": "That verdict is still being worked on. Give it a moment.",
  "error.bad_origin": "That request came from somewhere we don't recognize. Reload the page and try again.",
  "error.not_found": "We couldn't find that.",
  // Intentionally language-invariant: each aria label is written in the
  // language of the audience it serves (the TR side speaks to Turkish
  // readers, the EN side to English readers), whatever the current lang.
  "langToggle.toTr": "Türkçeye geç",
  "langToggle.toEn": "Switch to English",
} as const;

export type Key = keyof typeof en;

const tr = {
  "hero.title": "Kim haklı? Hemen çözelim.",
  "hero.titleLine1": "Kim haklı?",
  "hero.titleLine2": "Hemen çözelim.",
  "hero.eyebrow": "Üç bağımsız yargıç · Yargıçlar isimleri görmez",
  "hero.lead":
    "Neyi tartıştığını anlat. Üç yapay zekâ yargıcı ayrı ayrı karar verir, ne kadar anlaştıklarını da güven puanından görürsün.",
  "input.label": "Tartışma",
  placeholder:
    "Ne oldu? Kim ne diyor, neden?\n\nKarşı tarafın görüşünü onun anlatacağı gibi yaz. Yargıçlar zaten iki tarafı da en güçlü hâliyle ele alır.",
  getVerdict: "Kararı öğren",
  privacyNote:
    "Yargılamadan önce isimleri Taraf A ve Taraf B yapıyoruz, yani yargıçlar kimin kim olduğunu hiç bilmez.",
  judgeBy: "Neye göre?",
  fineTune: "İnce ayar ▸",
  hideFineTune: "İnce ayarı gizle",
  sliderNote: "Ortası tarafsız. Bunlar sadece iş değerlere dayanınca devreye girer.",
  "preset.balanced.label": "Dengeli",
  "preset.balanced.blurb": "Sağduyu ne derse",
  "preset.outcomes.label": "Sonuçlar",
  "preset.outcomes.blurb": "Önemli olan sonuç",
  "preset.principles.label": "İlkeler",
  "preset.principles.blurb": "Önce kurallar ve haklar",
  "preset.fairness.label": "Hakkaniyet",
  "preset.fairness.blurb": "Herkese aynı kural",
  "preset.loyalty.label": "Sadakat",
  "preset.loyalty.blurb": "Kurallardan önce insan",
  "slider.freedom_safety.left": "Özgürlük",
  "slider.freedom_safety.right": "Güvenlik",
  "slider.individual_group.left": "Birey",
  "slider.individual_group.right": "Toplum",
  "slider.head_heart.left": "Akıl",
  "slider.head_heart.right": "Kalp",
  "slider.aria": "{left} / {right} dengesi",
  "thinking.eyebrow": "Yargıçlar ne yapıyor",
  "thinking.read": "İki tarafı da okuyup en sağlam hâline getiriyoruz…",
  "thinking.label": "İddiaları ayırıyoruz: olgu mu, değer mi, tanım mı, mantık mı…",
  "thinking.dig": "Temele kadar kazıyoruz…",
  "thinking.reach": "Her tarafın temel taşını buluyoruz…",
  "thinking.crux": "Düğümü arıyoruz…",
  "thinking.judges": "Üç yargıç ayrı ayrı düşünüyor…",
  "thinking.votes": "Oyları sayıyoruz…",
  "thinking.helper":
    "Üç yapay zekâ yargıcı ayrı ayrı karar veriyor, oylar başa baş giderse ek yargıç da geliyor. Bir dakika sürebilir.",
  "thinking.finish": "Düğüme yaklaşıyoruz…",
  "thinking.stillJudging": "Yargıçlar hâlâ düşünüyor, biraz sabır…",
  "thinking.ready": "Karar hazır.",
  "verdict.win": "{name} haklı",
  "verdict.winSelf": "Sen haklısın",
  "verdict.split": "Bölünmüş karar",
  "verdict.conditional": "Değerlerine bağlı",
  "verdict.dissolved": "Aynı kelime, farklı anlamlar",
  "verdict.tooClose": "Başa baş, karar çıkmadı",
  "lean.title": "Zorunlu hüküm: {name} daha haklı",
  "lean.titleSelf": "Zorunlu hüküm: sen daha haklısın",
  "lean.unanimous": "Bütün yargıçlar bu taraftan yana.",
  "lean.majority": "Yargıçlar bu tarafı {for}–{against} seçti.",
  "lean.tie": "Seçmeye zorlanınca bile yargıçlar tam ortadan bölündü.",
  splitWin: "{name} şu konuda haklı:",
  splitWinSelf: "Sen şu konuda haklısın:",
  ifPrefix: "Eğer",
  "badge.factual": "Olgu tartışması",
  "badge.logical": "Mantık tartışması",
  "badge.definitional": "Tanım tartışması",
  "badge.values": "Değer tartışması",
  "badge.mixed": "Karma tartışma",
  "kind.fact": "olgu",
  "kind.value": "değer",
  "kind.definition": "tanım",
  "kind.logic": "mantık",
  bedrock: "🪨 Temel taşı",
  cruxShort: "⚡ Düğüm noktası",
  cruxTitle: "⚡ Düğüm noktası: kavga aslında ne üstüne",
  mapTitle: "Tartışma, temel taşlarına kadar",
  factsTitle: "Kararın dayandığı olgular (sen de bir bak)",
  bestPointTitle: "🤍 Karşı tarafın en sağlam kozu",
  share: "📤 Paylaş",
  copyLink: "🔗 Bağlantıyı kopyala",
  copied: "✓ Bağlantı kopyalandı",
  shareText: "Kavgayı yargıçlara sorduk. Bak kim kazandı.",
  copyPrompt: "Bu bağlantıyı kopyala:",
  judgeAnother: "Bir tane daha çözelim",
  "judgesVoted.one": "{n} bağımsız yapay zekâ yargıcı oy verdi:",
  "judgesVoted.other": "{n} bağımsız yapay zekâ yargıcı oy verdi:",
  escalated: "Oylar çok yakındı, o yüzden ek yargıç çağırdık.",
  "translate.loading": "Çevriliyor…",
  "translate.from.en": "İngilizceden çevrildi",
  "translate.from.tr": "Türkçeden çevrildi",
  "translate.failed": "Şu an çeviremedik, o yüzden aslını gösteriyoruz.",
  "translate.toggle": "Kararın dili",
  "vote.split": "bölünmüş",
  "vote.conditional": "duruma bağlı",
  "vote.dissolved": "anlam farkı",
  refusedNote: "Yapay zekâ bu kez pas geçti. Sahte bir karar göstermektense hiç göstermeyiz.",
  demoNote: "🎭 Demo modu: API anahtarı yok, bu örnek bir karar",
  "trial.survived": "🛡️ Karar sert bir çapraz sorgudan sağ çıktı. Güven puanı aynı kaldı.",
  "trial.uncertain": "⚠️ Çapraz sorgu ciddi şüphe bıraktı, o yüzden güven puanı sınırlandı",
  "trial.overturned": "⚠️ Karar çapraz sorguda tutunamadı, o yüzden güven puanı sınırlandı",
  "trial.whatWasTested": "Neyi sınadık",
  "trial.attackPrefix": "En sert itiraz:",
  "trial.refereePrefix": "Hakem:",
  "confidence.1": "Çok düşük",
  "confidence.2": "Düşük",
  "confidence.3": "Orta",
  "confidence.4": "Yüksek",
  "confidence.5": "Çok yüksek",
  confidenceWord: "{word} güven · {n}/5",
  confidenceAria: "Güven: 5 üzerinden {n}",
  verdictAria: "Karar: {label}",
  "party.a": "Taraf A",
  "party.b": "Taraf B",
  you: "Sen",
  "shared.subtitle": "Biri bu kararı paylaştı · isimler gizli",
  "shared.cta": "Sen de kendi tartışmanı çözdür →",
  errorFallback: "Bir şey ters gitti. Bir daha dener misin?",
  "error.not_configured":
    "Yargıç henüz kurulmamış. Biraz sonra yeniden dene.",
  "error.quota": "Yargıçların yapay zekâ kotası şimdilik doldu. Birkaç dakika sonra tekrar dene.",
  "error.unavailable": "Yargıçlara şu an ulaşamıyoruz. Bir dakika sonra tekrar dene.",
  "error.too_short": "Biraz kısa kaldı. Tartışmayı biraz daha anlat.",
  "error.too_long": "Epey uzun oldu. 6000 karakterin altında tut.",
  "error.invalid": "Bu istekte bir sorun var.",
  "error.rate_limited": "Ağır ol, burası mahkeme! Şimdilik sınıra geldin. {wait} sonra tekrar dene.",
  "error.daily_cap":
    "Mahkeme bugünlük kapandı, kaldırabileceği kadar kavga dinledi. {wait} sonra yine burada.",
  "error.captcha_failed": "İnsan olduğunu doğrulayamadık. Kontrolü bir daha dene, sonra yeniden gönder.",
  "wait.moment": "birkaç dakika",
  "wait.minute": "1 dakika",
  "wait.minutes": "{n} dakika",
  "wait.hour": "1 saat",
  "wait.hours": "{n} saat",
  "refused.headline": "Yapay zekâ buna karışmak istemedi",
  "refused.crux":
    "Yapay zekânın güvenlik filtresi bunu yargılamasına izin vermedi. Uydurma bir karardansa hiç karar olmaması iyi.",
  "refused.bestPoint": "Başka türlü anlatmayı dene. Ya da bazı kavgaların bir uygulamaya fazla geldiğini kabul et.",
  "refused.claim": "Atlandı",
  "nav.skip": "İçeriğe geç",
  "nav.home": "Judge ana sayfası",
  "nav.how": "Nasıl çalışır",
  "nav.primary": "Ana menü",
  "examples.label": "Fikir mi lazım? Şunlardan birini dene:",
  "example.hotdog.label": "🌭 Sosisli bir sandviç mi?",
  "example.hotdog.text":
    "Arkadaşım Mert sosislinin bir sandviç olduğunu söylüyor: dilimlenmiş ekmeğin içinde bir dolgu, bu kadar. Bence sosisli kendi başına bir şey. Kimse sandviç isteyip önüne sosisli gelmesini beklemez, hiçbir menü onu sandviçlerin altında yazmaz.",
  "example.tomato.label": "🍅 Domates meyve mi?",
  "example.tomato.text":
    "Ece domatesin sebze olduğunda ısrar ediyor, çünkü herkes onu sebze gibi pişirip yiyor. Bence meyve, çünkü botanik olarak çiçekten gelişiyor ve tohum taşıyor.",
  "example.whiteLie.label": "🤥 Beyaz yalan masum mu?",
  "example.whiteLie.text":
    "Deniz, aslında hiç beğenmediği hâlde arkadaşına yeni saçını çok sevdiğini söyledi ve böyle bir beyaz yalanın sadece incelik olduğunu savunuyor. Bence gerçek arkadaşlar doğruyu, nazikçe söylenmiş hâliyle duymalı.",
  "example.knuckles.label": "🦴 Parmak çıtlatmak kireçlenme yapar mı?",
  "example.knuckles.text":
    "Annem parmaklarımı çıtlatırsam kireçlenme olacağını söylüyor. Ben sürekli çıtlatıyorum ve bunun hiçbir kanıtı olmayan bir efsane olduğunu düşünüyorum.",
  "example.pineapple.label": "🍍 Pizzaya ananas olur mu?",
  "example.pineapple.text":
    "Selin pizzaya ananas koymanın İtalyan mutfağına hakaret olduğunu söylüyor. Bence pizza neyle lezzetliyse odur, gelenek tek başına bir argüman değil.",
  "advanced.summary": "Gelişmiş: değer ayarları",
  "advanced.current": "Şu an: {label}",
  "turnstile.label": "Hızlı bir kontrol: insan mısın?",
  "turnstile.error": "İnsan doğrulaması yüklenemedi. Sayfayı yenileyip tekrar dene.",
  privacyLink: "Yazdıklarına ne oluyor?",
  "how.title": "Nasıl çalışır",
  "how.kicker": "Beş adım",
  "how.lead": "Yazı tura yok. Her tartışma aynı beş adımdan geçer.",
  "how.step1.title": "İki tarafa da hakkını ver",
  "how.step1.body": "Her taraf en güçlü hâliyle yeniden anlatılır, haksız bulduğun taraf bile.",
  "how.step2.title": "İddiaları ayır",
  "how.step2.body":
    "Her iddiaya olgu, değer, tanım ya da mantık etiketi konur, çünkü her biri başka yoldan çözülür.",
  "how.step3.title": "Düğüm noktasını bul",
  "how.step3.body":
    "Her tarafın iddialarını temel taşına inene kadar kazar ve bütün kavganın döndüğü asıl noktayı bulur.",
  "how.step4.title": "Üç bağımsız yargıç",
  "how.step4.body":
    "Üç yargıç ayrı ayrı karar verir, oylar başa başsa ek yargıç çağrılır. Güven puanı ne kadar emin konuştuklarına değil, ne kadar anlaştıklarına bakar.",
  "how.step5.title": "Önce karar, sonra çapraz sorgu",
  "how.step5.body":
    "Kararı ve güven puanını alırsın, yanında karşı tarafın en sağlam kozu da gelir. Olgulara dayanan bir galibiyet ayrıca çapraz sorguya girer, sallanırsa güven puanı düşer.",
  "sample.title": "Bir karar neye benzer",
  "sample.kicker": "Sonuç",
  "sample.lead":
    "İşte sosisli davası. Senin kararında ayrıca her iddia temel taşına kadar açılır ve dayandığı olgular listelenir.",
  "sample.badge": "Örnek",
  "sample.nameA": "Mert",
  "sample.nameB": "Sen",
  "sample.label": "Sen haklısın",
  "sample.headline": "Kimse sandviç isteyip sosisli beklemez",
  "sample.crux":
    "Şekline bakarsan sosisli sandviç sayılabilir, ama günlük dilde sandviç deyince akla sosisli gelmez.",
  "sample.bestPoint":
    "İçine bir şey konmuş yarık bir ekmek, çoğu sözlükteki sandviç tanımına gerçekten uyuyor.",
  "faq.title": "Merak edilenler",
  "faq.kicker": "SSS",
  "faq.fair.q": "Adil mi?",
  "faq.fair.a":
    "Olmaya çok çalışıyor. İsimler Taraf A ve Taraf B olur, yargıçlar kimin kim olduğunu bilmez. İki tarafın da en güçlü hâli ele alınır ve üç yargıç ayrı ayrı karar verir. Anlaşamazlarsa güven puanı düşer ve bunu sana açıkça söyler. Oylar başa başsa önce ek yargıç çağrılır. Yine de yanılabilir, listelediği olgulara bir göz at.",
  "faq.private.q": "Metnim gizli kalıyor mu?",
  "faq.private.a":
    "Ücretsiz kararlar için hesap gerekmez. Yazdığın metin, içindeki isimlerle birlikte, isimler Taraf A ve Taraf B'ye çevrilsin diye bir kez Anthropic'in API'sine gider. Yalnızca bu anonim hâli yargılanır ve paylaşım bağlantın çalışsın diye yalnızca o saklanır. Paylaşılabilir bir sayfada görmek istemeyeceğin şeyleri yazma.",
  "faq.powers.q": "Arkasında ne var?",
  "faq.powers.a":
    "Anthropic'in Claude modeli. Üç yargıç aynı ayrıntılı talimatla yan yana çalışır, oylar başa başsa ek yargıçlar da katılır. Olgulara dayanan kazanan kararlar ayrıca çapraz sorgudan geçer. Güven puanını basit bir kod hesaplar, yargıçların ne sıklıkla anlaştığına bakar.",
  "faq.taste.q": "Ya iş sadece zevk meselesiyse?",
  "faq.taste.a":
    "O zaman bunu söyler: “Değerlerine bağlı” ya da “Aynı kelime, farklı anlamlar”. Yargıçların hangi tarafa yattığını da gösterir, üstünde açıkça zorunlu hüküm olduğu yazar.",
  "faq.legal.q": "Bu hukuki tavsiye mi?",
  "faq.legal.a":
    "Hayır. Judge eğlenmek ve gündelik atışmalara biraz daha net bakmak için. Hukuki, tıbbi ya da mali konularda işinin ehli birine danış.",
  "footer.about": "Hakkında",
  "footer.privacy": "Gizlilik",
  "footer.home": "Bir tartışma çözdür",
  "footer.note": "Eğlence ve netlik için, hukuki tavsiye değil.",
  "footer.language": "Dil",
  "footer.nav": "Site bağlantıları",
  "shared.ctaLead": "Senin de bir tartışman mı var?",
  "notFound.title": "Bu karar salonu çoktan terk etmiş",
  "notFound.body": "Bağlantıda bir yazım hatası olabilir ya da karar artık yok.",
  "about.title": "Judge hakkında",
  "about.kicker": "Nasıl karar veriyoruz",
  "about.lead":
    "Judge, gündelik kavgalar için küçük ve lafını esirgemeyen bir hakem. Neyi tartıştığını anlat, kimin haklı olduğunu söylesin. Bazen de kimsenin neden haklı olmadığını söyler, bu da en az o kadar işe yarar.",
  "about.methodTitle": "Yöntem",
  "about.honestTitle": "Dürüst etiketler",
  "about.honest":
    "Her kavganın bir kazananı olmaz. Karar net bir galibiyet, bölünmüş karar, “değerlerine bağlı” ya da “aynı kelime, farklı anlamlar” olabilir. Yine de kazanan istersen zorunlu bir hüküm verir ve üstüne bunu açıkça yazar.",
  "about.limitsTitle": "Sınırlar",
  "about.limit1":
    "Sadece ona anlattıklarını bilir ve hikâyeyi nasıl anlattığın sonucu etkiler. Karşı tarafı da onun anlatacağı gibi ekle.",
  "about.limit2":
    "Yapay zekâ yargıçları olgularda yanılabilir. Her karar dayandığı olguları listeler, sen de kontrol edebilirsin.",
  "about.limit3":
    "İsimleri değiştirmek çoğu zaman tutar, ama alışılmadık isimler ya da lakaplar gözden kaçabilir.",
  "about.limit4": "Eğlence ve netlik için. Hukuki, tıbbi ya da mali tavsiye değil.",
  "about.builtTitle": "Perde arkası",
  "about.built":
    "Judge, Anthropic'in Claude modeliyle çalışır. Üç yargıç aynı anda karar verir, oylar başa başsa ek yargıçlar da katılır. Ne kadar anlaştıkları güven puanını belirler. Kazanan olgusal bir hüküm de kesinleşmeden önce ayrı bir çapraz sorgudan geçer.",
  "privacy.title": "Gizlilik",
  "privacy.kicker": "Verilerin",
  "privacy.lead": "Kısacası: hesap isteğe bağlı, tartışmalarındaki gerçek isimleri hiç saklamıyoruz, hiçbir şey de satmıyoruz.",
  "privacy.storedTitle": "Neleri saklıyoruz",
  "privacy.stored":
    "Bir karar aldığında, paylaşım bağlantısı çalışmaya devam etsin diye anonim tartışmayı (isimler Taraf A ve Taraf B olarak), seçtiğin değer ayarlarını ve kararın kendisini kaydederiz. Yazdığın gerçek isimler hiç kaydedilmez. Sadece sonucu etiketlemek için kendi tarayıcına geri döner. Biri kararı diğer dilde açarsa çevrilmiş hâlini de saklarız.",
  "privacy.notStoredTitle": "Neleri yapmıyoruz",
  "privacy.notStored":
    "Reklam takibi yok, veri de satmıyoruz. Ücretsiz kararlar için hiç hesap gerekmez. Dil tercihin ve Ücretsiz ya da Premium seçimin sadece tarayıcının yerel depolamasında durur, başka hiçbir yerde değil.",
  "privacy.ipTitle": "Kullanım sınırı",
  "privacy.ip":
    "Mahkeme herkese açık kalsın diye bir ziyaretçinin kaç karar ve çeviri isteyebileceğine sınır koyuyoruz. Bunun için IP adresinin kendisini değil, anahtarlı bir özetini (hash) kullanım sınırı deposunda en fazla 24 saat tutuyoruz. İnsan doğrulaması açıksa IP adresin doğrulama için Cloudflare'a da gider. Kararınla birlikte asla kaydedilmez. Premium kararlar da aynı nedenle hesap başına sayılır.",
  "privacy.processorsTitle": "Metnin başka kimin elinden geçiyor",
  "privacy.processors":
    "Yazdığın metin, gerçek isimler dahil, isimler çıkarılsın diye önce Anthropic'in API'sine (Claude) gider. Sonra yalnızca anonim hâli yargılanır ve saklanır. İnsan doğrulaması açıksa Cloudflare Turnstile tarayıcında çalışır ve sonucu Cloudflare ile kontrol eder. Giriş yaparsan bu girişi seçtiğin Apple ya da Google yürütür, giriş e-postaları da Resend üzerinden gider. Barındırma sağlayıcımız standart sunucu kayıtlarını tutar.",
  "privacy.shareTitle": "Paylaşım bağlantıları",
  "privacy.share":
    "Bağlantısı olan herkes kararı görebilir. Bağlantılar uzun, rastgele kimlikler kullanır ve paylaşım sayfaları arama motorlarından dizine eklememelerini ister. Yani adres, telefon numarası ya da herkese açık bir sayfada görmek istemeyeceğin hiçbir şey yazma.",
  "privacy.contactTitle": "İletişim",
  "privacy.contact":
    "Soracağın bir şey mi var ya da bir kararı kaldırmamızı mı istiyorsun? Bağlantıyı ekleyip {email} adresine yaz.",
  "privacy.accountsTitle": "Hesaplar (isteğe bağlı)",
  "privacy.accounts":
    "Hesap sadece Premium için gerekir. Apple ya da Google ile giriş yaparsan bizimle paylaştıkları e-posta adresini, adını ve profil fotoğrafı bağlantını, bir de hangi yolla giriş yaptığını saklarız. Apple ya da Google da Judge'a giriş yaptığını görebilir. E-posta bağlantısıyla giriş yaparsan o e-posta Resend üzerinden gönderilir, bağlantıyı doğrulamak için de e-posta adresinle kısa süreli bir kayıt tutarız: bağlantı 10 dakika sonra geçersiz olur, kayıt da kullanılınca ya da süresi dolduktan kısa süre sonra silinir. Ayrıca oturum kayıtlarını (rastgele bir anahtar ve bitiş tarihi; IP adresi ya da cihaz bilgisi yok), kredilerini, planını ve geçmişini, bir de hangi premium kararların kredi kullandığını (sadece kararın kimliği) saklarız. Hesap sayfasından hesabını silersen bunların hepsi silinir. Paylaştığın kararlar anonim bağlantılar olarak kalır, çünkü hiçbirinde adın yoktu.",
  "privacy.webSearchTitle": "Premium: internet araması ve sorular",
  "privacy.webSearch":
    "Premium bir karar, anonim tartışmayı internet araması açık olarak Anthropic'e gönderir. Arama sorgularını model bu anonim metinden yazar, sonuçlar da Anthropic'in arama sağlayıcısından gelir. Kullanılan kaynaklar kararda gösterilir. Premium önce sana en fazla iki soru sorabilir: bu soruları bulmak için yazdığın metin, isimler dahil, bir kez daha Anthropic'e gider ve saklanmaz. Cevapların yargılamadan önce tartışmayla birlikte anonimleştirilir ve yalnızca bu anonim hâli kaydedilir.",
  "nav.signIn": "Giriş yap",
  "nav.account": "Hesap",
  "nav.pricing": "Fiyatlar",
  "nav.accountMenu": "Hesap menüsü",
  "nav.signOut": "Çıkış yap",
  "footer.pricing": "Fiyatlar",
  "tier.label": "Nasıl yargılansın",
  "tier.free": "Ücretsiz",
  "tier.premium": "Premium",
  "tier.freeHint": "Üç yargıç, her zamanki gibi.",
  "tier.premiumHint":
    "Olgular kaynaklarıyla internette kontrol edilir, kurul daha güçlüdür, eksik bir şey varsa kısa bir soru gelir.",
  "tier.signInToUse": "Premium için giriş yap",
  "tier.lockedSignIn": "(kilitli: kullanmak için giriş yap)",
  "tier.lockedNoAllowance": "(kilitli: kredi ya da aylık plan gerekiyor)",
  "tier.getPremium": "Premium'a geç",
  "tier.creditsLeft.one": "1 premium karar hakkın kaldı.",
  "tier.creditsLeft.other": "{n} premium karar hakkın kaldı.",
  "tier.monthlyLeft": "Bu ay {n} hakkın kaldı.",
  "tier.invite": "Olgular internette de kontrol edilsin mi? Premium bunu yapar.",
  "tier.outOfCredits": "Premium karar hakkın bitti. Ücretsiz sürüm her zamanki gibi çalışıyor.",
  "tier.fairUse": "Bu ayın premium kararlarını kullandın. Hakların {date} tarihinde yenilenir.",
  "tier.fairUseSoon": "Bu ayın premium kararlarını kullandın. Hakların yakında yenilenir.",
  "tier.checking": "Eksik bir şey var mı diye bakıyoruz…",
  "clarify.title": "Yargıçlar karar vermeden önce",
  "clarify.lead": "Bu ayrıntılar kimin haklı olduğunu değiştirebilir. Bildiklerini yaz ya da geç.",
  "clarify.answerAria": "{n}. sorunun cevabı:",
  "clarify.placeholder": "Cevabın (isteğe bağlı)",
  "clarify.skip": "Geç, kararı ver",
  "clarify.submit": "Kararı öğren",
  "clarify.back": "Tartışmayı düzenle",
  "thinking.factcheck": "Olguları internette kontrol ediyoruz…",
  "thinking.factcheckDone": "İnternet kontrolü bitti.",
  "thinking.premiumHelper":
    "Daha güçlü bir kurul ve internette olgu kontrolü biraz daha uzun sürer. Bir iki dakika verebilirsin.",
  "premium.badge": "Premium",
  "panel.premium": "İnternette olgu kontrolüyle premium kurul.",
  "panel.models": "Yargıçlar: {list}",
  "panel.strong": "{n} güçlü",
  "panel.quick": "{n} hızlı",
  "factcheck.title": "İnternette kontrol edildi",
  "factcheck.lead": "Yargıçlar karar vermeden önce bu arama sonuçlarını gördü. Bunlar kanıt, kararın kendisi değil.",
  "factcheck.status.supported": "Doğru çıktı",
  "factcheck.status.refuted": "Yanlış çıktı",
  "factcheck.status.mixed": "Kısmen doğru",
  "factcheck.status.unverified": "Doğrulanamadı",
  "factcheck.sources": "Kaynaklar",
  "factcheck.sourceAria": "{title}, yeni sekmede açılır",
  "factcheck.none": "İnternette bakılacak bir şey yok: bu tartışma olgulara değil, değerlere ya da anlamlara dayanıyor.",
  "factcheck.unavailable": "İnternet kontrolü bu kez tamamlanamadı, yargıçlar onsuz karar verdi.",
  "signin.title": "Giriş yap",
  "signin.lead": "Hesap sadece Premium için gerekir. Ücretsiz kararlar hiç hesap istemez.",
  "signin.apple": "Apple ile devam et",
  "signin.google": "Google ile devam et",
  "signin.emailToggle": "E-postayla devam et",
  "signin.emailLabel": "E-posta adresi",
  "signin.emailPlaceholder": "sen@ornek.com",
  "signin.emailSubmit": "Bana giriş bağlantısı gönder",
  "signin.emailSent": "Gelen kutuna bak. {email} adresine bir giriş bağlantısı gönderdik. 10 dakika geçerli.",
  "signin.emailInvalid": "Bu e-posta adresi doğru görünmüyor.",
  "signin.dev": "Test kullanıcısı olarak devam et",
  "signin.devNote": "Sadece yerel test için. Bu düğme canlı sitede hiç görünmez.",
  "signin.unavailable": "Bu sitede giriş henüz kurulmadı.",
  "signin.providerUnavailable": "Henüz kullanılamıyor",
  "signin.failed": "Giriş yapamadık. Bir daha dener misin?",
  "signin.legal": "Tartışmalarını harici bir yapay zekâ okur. Devam ederek",
  "signin.legalLink": "Gizlilik Politikası",
  "signin.legalAfter": "'nı kabul etmiş olursun.",
  "signin.loading": "Giriş seçenekleri yükleniyor…",
  "account.title": "Hesabın",
  "account.signedInAs": "{email} olarak giriş yaptın",
  "account.plan": "Planın",
  "account.plan.free": "Ücretsiz",
  "account.plan.premium": "Premium",
  "account.credits": "Kalan premium kredi",
  "account.subscription": "Aylık plan",
  "account.subscriptionNone": "Etkin değil",
  "account.subscriptionUntil": "{date} tarihine kadar geçerli",
  "account.subscriptionRenews": "{date} tarihinde yenilenir",
  "account.fairUse": "Bu ay {cap} premium karardan {used} tanesini kullandın",
  "account.getPremium": "Premium'a geç",
  "account.signOut": "Çıkış yap",
  "account.delete": "Hesabı sil",
  "account.deleteConfirm":
    "Hesabın silinsin mi? Kredilerin, planın ve giriş bilgilerin silinir. Kararların ve davalardaki tarafların kaldırılır: yazdıkların ve isimler silinir, paylaşım bağlantıları da çalışmaz olur.",
  "account.deleteYes": "Evet, sil",
  "account.deleteCancel": "Hesabım kalsın",
  "account.deleted": "Hesabın silindi. Ana sayfaya dönüyoruz…",
  "account.deleteFailed": "Hesabı şu an silemedik. Bir daha dener misin?",
  "account.signInPrompt": "Planını ve kredilerini görmek için giriş yap.",
  "account.loadFailed": "Hesabını yükleyemedik. Birazdan tekrar dene.",
  "account.loading": "Hesabın yükleniyor…",
  "account.verdicts.title": "Kararların",
  "account.verdicts.empty": "Henüz kararın yok.",
  "account.verdicts.loadFailed": "Kararlarını yükleyemedik.",
  "account.verdicts.removed": "Kaldırıldı",
  "pricing.title": "Ücretsiz ya da biraz fazlası",
  "pricing.lead":
    "Ücretsiz sürüm ücretsiz kalır. Premium; internette olgu kontrolü, daha güçlü bir yargıç kurulu ve eksik bir şey olunca kısa sorular ekler.",
  "pricing.free.title": "Ücretsiz",
  "pricing.free.price": "Her zaman ücretsiz",
  "pricing.free.f1": "Üç bağımsız yargıç ve dürüst bir güven puanı",
  "pricing.free.f2": "Yargılamadan önce isimler gizlenir",
  "pricing.free.f3": "Hesap gerekmez",
  "pricing.premium.title": "Premium",
  "pricing.premium.f1": "Olgular internette kontrol edilir, kaynaklar kararında görünür",
  "pricing.premium.f2": "Claude Sonnet'li daha güçlü bir yargıç kurulu",
  "pricing.premium.f3": "Önemli bir olgu eksikse en fazla iki kısa soru",
  "pricing.packsTitle": "Kredi paketleri",
  "pricing.packsLead": "Bir kez öde, istediğin zaman kullan. Her premium karar bir kredi kullanır.",
  "pricing.pack": "{n} premium karar",
  "pricing.perVerdict": "Karar başına {price}",
  "pricing.monthly.title": "Aylık plan",
  "pricing.monthly.renews": "Her ay yenilenir",
  "pricing.monthly.cap": "Ayda en fazla {n} premium karar",
  "pricing.comingSoon": "Yakında",
  "pricing.note": "Fiyatlar ABD doları cinsinden. Ödemeler henüz açılmadı, yani bugün bir şey satın alınamıyor.",
  "pricing.signIn": "Premium için giriş yap",
  "pricing.preview": "Premium burada henüz açılmadı. Bu sayfa bir önizleme.",
  "error.signin_required": "Premium'u kullanmak için giriş yap.",
  "error.premium_required": "Premium kararlar için kredi ya da aylık plan gerekiyor.",
  "error.no_credits": "Premium kredin bitti. Ücretsiz kararlar yine çalışıyor.",
  "error.fair_use": "Bu ayın premium kararlarını kullandın. Hakların {date} tarihinde yenilenir.",
  "error.fair_useSoon": "Bu ayın premium kararlarını kullandın. Hakların yakında yenilenir.",
  "error.in_progress": "Bu karar hâlâ hazırlanıyor. Biraz bekle.",
  "error.bad_origin": "Bu istek tanımadığımız bir yerden geldi. Sayfayı yenileyip tekrar dene.",
  "error.not_found": "Bunu bulamadık.",
  "langToggle.toTr": "Türkçeye geç",
  "langToggle.toEn": "Switch to English",
} as const satisfies Record<Key, string>;

export const STRINGS = { en, tr } as const;

/** Look up a string and interpolate `{var}` slots. Unknown braces are left alone. */
export function t(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s: string = STRINGS[lang][key];
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
};

/** Keys whose `{date}` slot has a whole-sentence fallback for when the
 * server sent no usable date, so a raw `{date}` never reaches the reader. */
const DATELESS_KEY: Partial<Record<Key, Key>> = {
  "error.fair_use": "error.fair_useSoon",
  "tier.fairUse": "tier.fairUseSoon",
};

/** An ISO timestamp as a short calendar date ("November 18" / "18 Kasım").
 * Null for missing or unparseable input. Intl only: no DOM, so the mobile
 * app can reuse it. */
export function formatDate(lang: Lang, iso: unknown): string | null {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(lang === "tr" ? "tr-TR" : "en-US", {
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
