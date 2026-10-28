import type { PluralForms } from "../../../lib/i18n";

/**
 * Strings only the native apps need (tabs, history, offline states), in
 * English, the source every language in ./locales is checked against. Same
 * rules as lib/i18n.ts: one whole string per language, `{slot}`
 * placeholders only where the sentence was written around them. Keys use an
 * "app." prefix so they can never collide with web keys.
 *
 *   npm run check:app-locales           every language
 *   npm run check:app-locales -- de fr  just these
 */
export const APP_EN = {
  "app.name": "Judge",
  "app.tab.new": "New",
  "app.tab.history": "My verdicts",
  "app.tab.settings": "Settings",
  "app.input.counter": "{count} / {max}",
  "app.history.title": "My verdicts",
  "app.history.empty": "No verdicts yet. Settle your first argument and it shows up here.",
  "app.history.deviceOnly": "Saved on this phone only. Deleting one here doesn't take down its share link.",
  "app.history.delete": "Delete",
  "app.history.clearAll": "Delete all",
  "app.history.clearConfirm": "Delete every saved verdict from this phone? Share links keep working.",
  "app.history.clearYes": "Yes, delete them",
  "app.pricing.free.account": "Sign in with Apple, Google or email",
  "app.pricing.headline": "Your first verdict is on us.",
  "app.pricing.sub":
    "Create an account and your first verdict is free, with every feature. After that, pick a pack or go monthly.",
  "app.pricing.headlineMember": "Get more verdicts.",
  "app.pricing.subMember": "Pick a pack or go monthly. Every verdict gets the full panel.",
  // Every verdict, a case included, uses one credit or one of the monthly plan's.
  "app.balance.left": "{n} verdicts left",
  "app.balance.monthly": "{left} of {cap} left this month",
  "app.balance.none": "No verdicts left",
  "app.balance.caseCost": "Sending a link uses 1 verdict",
  "app.cancel": "Cancel",
  "app.retry": "Try again",
  "app.error.offline": "You seem to be offline. Check your connection and try again.",
  "app.error.timeout": "The judges took too long to answer. Try again in a minute.",
  "app.error.interrupted":
    "The connection dropped while Judge was in the background. Keep the app open until the verdict arrives, then try again.",
  // App versions of web copy that talks about pages, tabs and reloading
  // (turnstile.error, factcheck.sourceAria, error.bad_origin; see EXCLUDE_KEYS).
  "app.turnstile.error": "The human check couldn't load. Check your connection and try again.",
  "app.factcheck.sourceAria": "{title}, opens the web page",
  "app.error.badOrigin":
    "That request came from somewhere we don't recognize. Make sure the app is up to date and try again.",
  "app.translate.offline": "Can't translate while you're offline, so here's the original.",
  "app.share.title": "Share the verdict",
  "app.settings.language": "Language",
  "app.settings.languageDevice": "Same as the phone",
  "app.settings.about": "About Judge",
  "app.settings.version": "Version {version}",
  // Sign-in. Email in the apps is a 6-digit code, not a link.
  "app.signin.required": "Sign in to get a verdict.",
  "app.signin.or": "or",
  "app.signin.codeRequest": "Email me a code",
  "app.signin.codeSent": "We emailed a code to {email}. It works for 10 minutes.",
  "app.signin.codeLabel": "Enter the 6-digit code",
  "app.signin.codeSubmit": "Sign in",
  "app.signin.codeInvalid": "That code isn't right. Check the email and try again.",
  "app.signin.codeExpired": "That code has expired. Ask for a new one.",
  "app.signin.codeTooMany": "Too many wrong tries for this code. Ask for a new one.",
  "app.signin.codeResend": "Send a new code",
  "app.signin.changeEmail": "Use a different email",
  "app.signin.rateLimited": "Too many tries. Wait a minute and try again.",
  // App version of signin.unavailable, which talks about "this site".
  "app.signin.unavailable": "Sign-in isn't available right now. Try again later.",
  // Account. account.deleteConfirm is one web paragraph; native dialogs need
  // a title, a body and a button.
  "app.account.deleteTitle": "Delete your account?",
  "app.account.deleteBody":
    "Your sign-in details, credits, plan and personal data are deleted, and your share links stop working. Verdict text stays stored without your name, as explained in the Privacy Policy.",
  "app.account.deleteConfirm": "Delete account",
  // App version of account.deleted, which promises a trip to the home page.
  "app.account.deleted": "Your account was deleted.",
  "app.account.signOutConfirm": "Sign out of Judge on this phone?",
  "app.account.signedOut": "You're signed out.",
  "app.account.sessionExpired": "You've been signed out. Sign in again to continue.",
  "app.close": "Close",
  // Home with both sides on one screen. The joined text is what the judges
  // read when one person writes both sides.
  "app.home.lead": "Write both sides, or send the other person a link to write theirs.",
  "app.home.leadSolo": "Write your side, and theirs if you know it.",
  "app.home.yourSide": "Your side",
  "app.home.theirSide": "Their side",
  "app.home.yourName": "Your name",
  "app.home.theirName": "Their name",
  "app.home.yourPlaceholder": "What happened, from where you stand?",
  "app.home.theirPlaceholder": "What do they say? Write it the way they would.",
  "app.home.yourSideLabel": "Your side of the argument",
  "app.home.theirSideLabel": "Their side of the argument",
  "app.home.sendLink": "Or send them a link to write it",
  "app.home.says": "{name} says:",
  "app.home.mySide": "My side:",
  "app.home.otherSide": "Their side:",
  "app.home.example": "Try an example",
  // Cases the example button fills in, a on "your side" and b on "theirs".
  "app.example.dishwasher.aName": "Alex",
  "app.example.dishwasher.a":
    "You put the bowls on the top rack again. They never come out clean up there, that's what the bottom is for.",
  "app.example.dishwasher.bName": "Sam",
  "app.example.dishwasher.b":
    "They fit fine up there and it leaves the bottom free for the pans. I've loaded it like this for years and nothing's come out dirty.",
  "app.example.bill.aName": "Priya",
  "app.example.bill.a":
    "I didn't drink anything, so I shouldn't pay a quarter of the wine. Splitting the food evenly is fine with me.",
  "app.example.bill.bName": "Jordan",
  "app.example.bill.b":
    "We always just split it four ways. Working out who had what every time is a pain, and it's not much of a difference anyway.",
  "app.example.thermostat.aName": "Taylor",
  "app.example.thermostat.a": "It's 19 degrees in here and I'm cold even in a hoodie. Turning it up to 22 isn't crazy.",
  "app.example.thermostat.bName": "Chris",
  "app.example.thermostat.b":
    "22 is way too warm to sleep in. You can put on another layer, I can't take anything else off.",
  "app.example.roadTrip.aName": "Morgan",
  "app.example.roadTrip.a": "I drove the whole six hours there. It's only fair that you drive us back.",
  "app.example.roadTrip.bName": "Riley",
  "app.example.roadTrip.b":
    "I said before we left that I hate driving at night, and we're leaving at 7. I'll take the morning drives next trip.",
  "app.example.seat.aName": "Jamie",
  "app.example.seat.a": "My seat reclines, so I'm reclining it. It's a night flight and everyone's trying to sleep.",
  "app.example.seat.bName": "Casey",
  "app.example.seat.b":
    "I'm 6'3\" and my knees are already pressed into your seat. You could at least ask before dropping it all the way back.",
  "app.example.spoiler.aName": "Maya",
  "app.example.spoiler.a":
    "You told me who the killer was before I'd even started the last episode. I'd been waiting all week for it.",
  "app.example.spoiler.bName": "Leo",
  "app.example.spoiler.b":
    "It came out three weeks ago and you said you'd finished it. I can't keep track of where everyone is.",
  "app.example.jacket.aName": "Noah",
  "app.example.jacket.a": "You wore my denim jacket to the concert without asking. It came back smelling like smoke.",
  "app.example.jacket.bName": "Ava",
  "app.example.jacket.b":
    "It was hanging by the door and you never wear it. I would've asked, but you were asleep and I was already late.",
  "app.example.lastSlice.aName": "Ben",
  "app.example.lastSlice.a": "I called dibs on the last slice before the movie started. Everyone heard me.",
  "app.example.lastSlice.bName": "Lily",
  "app.example.lastSlice.b":
    "You can't call dibs and then not touch it for two hours. It was just sitting there going cold, so I ate it.",
  // The case page while the other side has not written yet.
  "app.case.waitingKicker": "Case · waiting",
  "app.case.waitingFor": "Waiting for {name}",
  "app.case.waitingLead":
    "{name} writes their side without an account. Neither of you sees the other's words until the ruling.",
  "app.case.waitingLeadAnon":
    "They write their side without an account. Neither of you sees the other's words until the ruling.",
  "app.case.sendTo": "Send {name} this link",
  "app.case.stepYou": "You wrote your side",
  "app.case.stepYouNote": "Sealed until the ruling",
  "app.case.stepThem": "{name} writes theirs",
  "app.case.stepThemAnon": "They write theirs",
  "app.case.stepThemNote": "This page updates when it's in",
  "app.case.stepJudges": "Three judges rule",
  "app.case.stepJudgesNote": "Or judge now on your side alone",
  "app.case.judgeNowWithout": "Judge now without {name}",
  // The ruling card and its details screen.
  "app.verdict.vs": "vs",
  "app.verdict.leanTo": "The panel leaned to {name}",
  "app.verdict.leanNone": "The panel didn't lean either way",
  "app.verdict.sides": "What each side stands on",
  "app.verdict.claims": "How each side got there",
  "app.verdict.back": "Ruling",
  // Adding context to a ruling (one-sided verdicts and cases).
  "app.appeal.title": "Add context & appeal",
  "app.appeal.intro": "Something the judges missed? Add it and they rule again. The first ruling stays on record.",
  "app.appeal.ask": "What should they know?",
  "app.appeal.placeholder": "A fact, a message, or what was actually agreed.",
  "app.appeal.cost": "Uses 1 verdict. You can do this twice per ruling; {left} left.",
  "app.appeal.costCase": "Uses 1 verdict. You can do this once per case.",
  "app.appeal.submit": "Rule again",
  // The web's appeal.* lines in the sheet's wording.
  "app.appeal.upsell": "Something missing? Add context and have it re-judged for 1 verdict.",
  "app.appeal.signIn": "Sign in to add context & appeal",
  "app.appeal.used": "You've already added context to this case.",
  "app.appeal.limit": "You've added context twice. That's the limit for one verdict.",
  // Store purchases. "arriving" and "slow" follow "success" on Android while
  // the credits are on their way.
  "app.purchase.buying": "Buying…",
  "app.purchase.success": "Thanks! Your purchase went through.",
  "app.purchase.pending": "Your purchase is being processed. It may take a minute to show up.",
  "app.purchase.arriving": "Your credits are on their way…",
  "app.purchase.slow": "It may take a minute to show up here.",
  "app.purchase.failed": "The purchase didn't go through. Try again in a moment.",
  "app.purchase.restore": "Restore purchases",
  "app.purchase.restoreDone": "Your purchases were restored.",
  "app.purchase.restoreNone": "No purchases to restore.",
} as const;

export type AppKey = keyof typeof APP_EN;

/**
 * App strings whose {n} counts the thing they name, handed every number
 * including 1. The string itself is the "other" form; each language adds the
 * other forms it has by Intl.PluralRules category (Russian one/few/many), as
 * COUNT_KEYS does on the web.
 */
export const APP_COUNT_KEYS = ["app.balance.left"] as const satisfies readonly AppKey[];

export type AppCountKey = (typeof APP_COUNT_KEYS)[number];

export const APP_PLURALS_EN: Partial<Record<AppCountKey, PluralForms>> = {
  "app.balance.left": { one: "{n} verdict left" },
};

/** The app strings in one language other than English, ./locales/<code>.ts. */
export type AppLocale = {
  strings: Record<AppKey, string>;
  plurals?: Partial<Record<AppCountKey, PluralForms>>;
};
