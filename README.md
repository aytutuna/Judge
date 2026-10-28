# ⚖️ Judge

> The product and the repository are called Judge. Server-side names (`/opt/verdict`, `verdict.service`, `verdict-update`, the `/api/verdict` route, database paths) keep "verdict".

Tell it the argument. It digs to bedrock and rules.

Judge is a mobile-first web app that settles arguments: one person describes a
disagreement, and an AI judge steelmans both sides, maps each side's claims down
to its **bedrock** premise, finds the **crux** — the one point the fight is
actually about — and renders a verdict.

## Honest verdicts, always labeled

Judge never launders an opinion through a confident interface. Every ruling
carries an explicit type:

| Verdict | When |
|---|---|
| **Party A / B is right** | The default. A checkable fact, a logical error, ordinary usage of a word, or a sensible common-sense framework favors one side — and the facts the ruling leans on are listed so you can check them |
| **Split decision** | Each side is right about a different part, and both parts matter about equally |
| **It depends on your values** | Only when the value frameworks are genuinely balanced — you get "if you weight X → then Y" branches instead of fake certainty |
| **Same word, different meanings** | Only when both uses of the word are fully standard and the argument dissolves once definitions are separated |
| **Too close to call** | The independent judges couldn't agree, even with extra judges called in, and their forced rulings don't (near-)unanimously favor a side that one of them ruled for |

**Forced ruling — someone is always more right**: every new non-winner verdict
also records a forced ruling: each judge must separately say who is more right
under a preponderance standard (balance of probabilities for uncertain facts,
ordinary usage for definitions, the value framework for values, burden of proof
for ties). The lean shown is the majority of those forced votes, and when the
judges split evenly it says so — closure never comes at the price of the
honest label.

**Confidence is computed, not claimed**: the judge runs up to three times
independently (one run analyzes the sides in reverse order as a position-bias
check), and the card shows how many of them voted for the ruling
("Confidence 3 of 3"). Behind it is a 1–5 score from the same agreement; when
that first round lands at 2 or below, two more judges are called in and every
vote is counted again ("of 5"), so a close call gets a bigger panel instead of
a coin flip; the verdict notes when this happened. Fact/logic winner rulings
are then cross-examined — an adversarial attack on the crux, judged by a
separate referee; a ruling that does not survive keeps its verdict, its
internal score is capped, and the attack is shown with a warning.

**Privacy = fairness**: before judging or storing anything, names are replaced
with *Party A* / *Party B*. The judge never knows who is who — which is also the
bias mitigation — and only the anonymized text is stored. The anonymizer is
itself a Claude call, so the raw text, names included, does go to Anthropic
once; the privacy page says so. The name map returns to your browser only,
where it puts the real names back into the verdict you see (a first-person
narrator reads as "You" / "Sen"); share pages and the stored row stay
anonymized. The anonymizer's output is checked in code: the names it lists
are substituted in its text (including possessives and Turkish suffixes such
as "Ryan's", "Burak'ın", "Burakla"), and a listed name that still survives, an
untouched echo of the input, or capitalized words that survive unlisted
trigger one retry at `medium` effort with a firmer instruction. If
anonymization fails for any reason (refusal, quota, timeout, malformed
output, a name that survives the retry), the request fails closed: nothing
is judged and nothing is stored.

**Türkçe / Turkish**: a TR | EN toggle in the header switches the whole UI, and
the chosen language rides along with each request so the judges, the
cross-examination, and even refusal verdicts are written in natural, informal
Turkish — JSON structure and enum values stay English. The preference lives in
your browser (no cookies, no locale routing); shared `/v/[id]` pages render
their chrome from the visitor's `Accept-Language` header while the verdict
content keeps the language it was judged in.

## Run it

```bash
npm install
cp .env.example .env    # then add your Anthropic API key (required)
npm run dev
```

An `ANTHROPIC_API_KEY` is **required** — without one the API refuses to judge
(no canned fallback: this app never fakes a ruling). Get a key at
[console.anthropic.com](https://console.anthropic.com).

> ⚠️ **Never commit `.env`.** If a key has ever been pasted into a chat, issue,
> or commit, rotate it in the Anthropic Console before going public.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | *(required)* | Anthropic API key |
| `DATABASE_URL` | `file:./dev.db` | Local SQLite file (on a single server, e.g. `file:/var/lib/verdict/verdict.db` in the Lightsail guide), or a Turso `libsql://…` URL on serverless hosts such as Vercel |
| `DATABASE_AUTH_TOKEN` | *(empty)* | Turso database token (only for a `libsql://` URL) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | *(empty)* | Upstash Redis for rate limits shared by every server instance. Unset = in-memory limits, which only hold within one process: fine locally and on a single-process server (the Lightsail guide), not on serverless hosts that run many instances |
| `RATE_LIMIT_SALT` | *(Upstash token)* | Secret key for hashing visitor IPs before they reach the rate-limit store. Any long random string. Unset = the Upstash token is used. Changing it resets every visitor's limits |
| `ORIGINALS_KEY` | *(required in production)* | 32 random bytes, base64 (`openssl rand -base64 32`): encrypts every stored original text, name map and share-page display name (AES-256-GCM). Back it up apart from the database (e.g. in a password manager): losing it makes the stored originals unreadable, and leaking it together with a database copy exposes them. Unset in development = a fixed development key (with a warning). Unset or invalid in production = originals and display names are not stored (one error line per process, one warning per skipped item); verdicts still work and share pages show Party A / Party B. See *Stored originals, names and removal* |
| `ORIGINALS_KEY_PREVIOUS` | *(empty)* | Older keys, comma-separated, used only to decrypt after a rotation. New data is always sealed with `ORIGINALS_KEY`. Keep an old key here as long as anything sealed with it may still be read, including stored Sign in with Apple tokens (see *Key rotation*) |
| `REMOVAL_LOG` | *(`removals.log` beside a local database file)* | Append-only log of removals (ids, party, reason, time; no text or names), kept outside the database so `scripts/originals.ts replay-removals` can re-apply them after a backup is restored. `off` disables it; a remote (`libsql://`) database has none unless this is set |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | *(empty)* | Cloudflare Turnstile site key. Unset = no bot-check widget |
| `TURNSTILE_SECRET_KEY` | *(empty)* | Turnstile secret for server-side verification. Unset = verification skipped (local dev) |
| `NEXT_PUBLIC_SITE_URL` | *(Vercel production domain, else `http://localhost:3000`)* | Public origin, e.g. `https://verdict.example.org`, used for canonical links, link previews, `robots.txt` and the sitemap. Set it for a custom domain or a host other than Vercel. Read at build time, so redeploy after changing it |
| `CONTACT_EMAIL` | *(empty)* | Address shown on `/privacy` for questions and removal requests. Unset or a placeholder (`example.com`) = the contact section is hidden. Read at build time, so redeploy after changing it |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | Judge and crux-trial model |
| `CLAUDE_MODEL_LITE` | `claude-haiku-5-5` | Anonymizer model (runs at `low` effort; its one retry runs at `medium`) |
| `JUDGE_EFFORT` | `medium` | Thinking depth for judge and trial calls: `low`, `medium` or `high` |
| `JUDGE_RUNS` | `3` | Self-consistency runs per verdict (1–3), run in parallel. Lower it to cut cost; confidence is capped accordingly |
| `JUDGE_EXTRA_RUNS` | `2` | Extra judges (0–4, in parallel) called in when the first round's confidence is at or below `JUDGE_ESCALATE_AT`; all votes are then aggregated together. `0` turns escalation off |
| `JUDGE_ESCALATE_AT` | `2` | Confidence (1–5) at or below which a verdict escalates. Only low-confidence verdicts escalate; with `JUDGE_RUNS=1` that is every verdict (one run caps confidence at 2), so set `JUDGE_EXTRA_RUNS=0` there if you want exactly one judge call |
| `CRUX_TRIAL` | `1` | Cross-examination of fact/logic winner rulings (up to 2 extra calls). Set `0` to skip it |

**Cost and latency of the baseline pipeline** (`scripts/eval.ts`,
`scripts/live-check.ts`; the site and the apps run the premium pipeline
below, which uses `JUDGE_EXTRA_RUNS`, `JUDGE_ESCALATE_AT` and `CRUX_TRIAL`
too): one run costs 1 anonymizer call + `JUDGE_RUNS` judge
calls (in parallel), plus up to 2 sequential trial calls when a fact/logic
winner is declared, so winner verdicts take a little longer. Only a
low-confidence verdict adds `JUDGE_EXTRA_RUNS` more judge calls (one more
parallel round, about **$0.002** extra at the default 2). Measured on
Haiku 5.5 ($0.10 / $0.50 per 1M input / output tokens), a judge call uses
about 3,050 input and 1,300 output tokens, so a full verdict (3 judges +
anonymizer + up to 2 trial calls) costs roughly **$0.004–0.006** — about
**$4–6 per 1,000 verdicts**.
Each call has a fixed time budget (60s for the anonymizer, retry included, 120s for judges,
45s for escalation judges, 60s total for the trial), so a verdict never hangs
indefinitely and the worst case (285s) fits the route's 300s limit. The SDK retries rate-limit and overload errors
automatically, and a verdict that still fails on a 429 is reported as a quota
error.

## Abuse protection

Every verdict needs a signed-in account (`401 signin_required` otherwise)
and one premium unit, so the account is the main gate. On top of that,
`lib/ratelimit.ts` counts premium verdicts per account and the site-wide
`PREMIUM_DAILY_CAP` (see *Accounts and Premium*), and the routes anyone can
reach without an account (translations, the respondent's answer, polling)
per visitor IP. An IPv6 visitor is counted per /64 prefix, since one client
usually holds a whole /64. The store only sees a keyed hash (HMAC-SHA256
with `RATE_LIMIT_SALT`) of the IPv4 address or IPv6 prefix, kept for up to
24 hours. The store is Upstash Redis when configured, else the app's
memory. If Redis is down or slow, requests are refused (`503 unavailable`)
rather than let through unmetered. The Cloudflare Turnstile check
(`lib/turnstile.ts`) guards the steps that need no account: asking for a
sign-in email and the respondent's answer to a two-sided case.

The visitor IP comes from the first `X-Forwarded-For` entry, so it is only
trustworthy behind a proxy that overwrites that header: Vercel does, and so
does the Caddy setup in the Lightsail guide below, also behind Cloudflare's
proxy (see *Custom domain behind Cloudflare*).

## Accounts and Premium

Every verdict is **Premium**: clarifying questions, web fact-checking with
sources and the Sonnet/Haiku judge panel. There is no free tier: getting a
verdict needs an account (Apple, Google or an emailed link; `401
signin_required` otherwise), and the site stays browsable signed out. Each
verdict, two-sided case and appeal costs one premium unit: a credit, or one
of the monthly plan's 35 verdicts a month, bought in the apps through
RevenueCat (see *Purchases* below). Every new account gets one credit when it
is created (a `promo` grant keyed `welcome:<user id>`), once per email
address: a keyed hash of the address goes into `welcome_claims`, which
account deletion leaves alone. Accounts from before this got nothing. A `tier` sent by older app builds is
ignored. `GET /api/v1/config` reports `freeTier: false` and
`welcomeCredits: 1`. Prices live in `lib/pricing.ts`; until
`PURCHASES_ENABLED=1` the buy buttons read "Coming soon". Testers get premium
from the admin script below.

Accounts use [Better Auth](https://www.better-auth.com) on the same database
(`DATABASE_URL`). The tables (`user`, `session`, `account`, `verification`
and the entitlement tables) are created automatically on first use. Sessions
store no IP address or device string, and provider access tokens are dropped
after sign-in.

| Env var | Default | Meaning |
|---|---|---|
| `BETTER_AUTH_SECRET` | *(required in production)* | At least 32 random characters (`openssl rand -base64 32`). Signs session cookies. Unset in production = accounts and Premium are off, and `/api/v1/config` reports every sign-in method as unavailable; the free site is unaffected. Locally a fixed development secret is used (with a warning) |
| `BETTER_AUTH_URL` | `NEXT_PUBLIC_SITE_URL`, else the local host | Public origin, e.g. `https://verdict.example.org`. OAuth callbacks are `<origin>/api/auth/callback/google` and `/apple` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(empty)* | Google OAuth client of type "Web application". Both set = the Google button works |
| `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` | *(empty)* | Extra accepted ID-token audiences for the future mobile app |
| `APPLE_CLIENT_ID` | *(empty)* | Apple Services ID used for web sign-in (e.g. `org.verdict.web`) |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID` | *(empty)* | Your 10-character Apple team id, and the key id of the Sign in with Apple key |
| `APPLE_PRIVATE_KEY_BASE64` | *(empty)* | The whole `AuthKey_<KEYID>.p8` file, base64-encoded on one line (`base64 -w0 AuthKey_XXXX.p8`). The app signs Apple's client secret from it and renews it on its own. All four Apple values set = the Apple button works |
| `APPLE_APP_BUNDLE_ID` | *(empty)* | The iOS app's bundle id, accepted as an extra audience for native Sign in with Apple |
| `RESEND_API_KEY`, `EMAIL_FROM` | *(empty)* | [Resend](https://resend.com) API key and sender, e.g. `Judge <signin@okjudge.com>` on a domain verified in Resend. Both set = email sign-in links (website) and email sign-in codes (apps) work. With `TURNSTILE_SECRET_KEY` set, the website's email form needs a Turnstile token too; the app code endpoints rely on rate limits instead |
| `REVIEW_ACCOUNT_EMAIL`, `REVIEW_ACCOUNT_CODE` | *(empty)* | The store-review account (App Review, Play review): this address always gets this 6-digit sign-in code in the apps' email option, and no email is sent to it. Both set, plus email sign-in configured, turns it on; the code must not be a repeated digit or `123456`/`654321`. Put the same values in the review notes when submitting. Use a dedicated address on your own domain, never a real person's: that address stops receiving codes, and whoever owns the mailbox at Apple or Google could also sign into the account. At most 10 code requests an hour for this address (each allows 3 guesses); clear or change the code after each review. It is an ordinary account otherwise |
| `DEV_LOGIN` | *(empty)* | `1` shows a "test sign-in" for local testing. It works only when **all** hold: not a production build (`next build` output is production whatever `NODE_ENV` it is started with), `DEV_LOGIN=1`, the server listens on `127.0.0.1` or `::1` only (`npm run dev:login`, i.e. `next dev -H 127.0.0.1`; plain `npm run dev` listens on every interface and is refused), and the request's `Host` is `localhost`, `127.0.0.1` or `[::1]`. Anywhere else the endpoint answers 404 |
| `PREMIUM_ENABLED` | `1` | `0` turns Premium off (the switch disappears; premium requests get `503 not_configured`) |
| `PREMIUM_DAILY_CAP` | `500` | Site-wide premium runs per UTC day, counted from the database, refunded ones included (a refused or failed run still costs its model calls). A cost circuit breaker; `0` pauses Premium. Clarifying questions are not counted; the per-account limit below bounds them |
| `PREMIUM_JUDGE_MODELS` | `claude-sonnet-5-5,claude-sonnet-5-5,claude-haiku-5-5` | Premium panel seats, in order (1 to 5) |
| `PREMIUM_SONNET_EFFORT` | `medium` | Thinking depth for non-Haiku premium judges: `low`, `medium` or `high` |
| `PREMIUM_FACTCHECK_MODEL` | `claude-haiku-5-5` | Model for the web fact-check |
| `PREMIUM_FACTCHECK_MAX_SEARCHES` | `3` | Web searches per fact-check (1 to 5), $0.01 each |
| `CASES_ENABLED` | `1` | `0` turns off two-sided cases and appeals (`/api/v1/cases*` and `/api/v1/respond/*` answer `503 not_configured`, `GET /api/v1/config` reports `features.cases: false`). Also off whenever Premium is off |
| `EVIDENCE_ENABLED` | `1` | `0` turns off screenshot evidence (upload endpoints answer `503 not_configured`, evidence tokens are refused with `400 evidence_invalid`, `features.evidence: false`). Always off when Premium is off |
| `EVIDENCE_MODEL` | `claude-haiku-5-5` | Vision model that transcribes evidence images |
| `PURCHASES_ENABLED` | *(empty)* | `1` = `GET /api/v1/config` reports `pricing.purchasesEnabled: true`, so the apps offer their in-app purchases. Anything else = false ("Coming soon") |
| `REVENUECAT_WEBHOOK_SECRET` | *(empty)* | Shared secret for `POST /api/v1/webhooks/revenuecat`; set RevenueCat's webhook Authorization header to `Bearer <secret>`. Unset = the webhook answers `503 not_configured` |
| `ALLOW_SANDBOX_PURCHASES` | *(empty)* | `1` = also apply RevenueCat events with `environment: SANDBOX` (TestFlight, Play test tracks). Leave unset on the live server: sandbox purchases are free |

Sign-in providers without credentials are reported as unavailable by
`GET /api/v1/config`, and the sign-in page shows them disabled.

**Limits for Premium:** per account 10 premium verdicts per 10 minutes and
60 per 24 hours, 20 clarifying-question requests per 10 minutes and 100 per
24 hours (`429 rate_limited`), plus `PREMIUM_DAILY_CAP` (`503 daily_cap`).
Verdicts skip Turnstile: the signed-in account and these limits are the gate. A
premium credit is reserved before any model call and returned automatically
if the verdict fails, if the judges decline, or if every Sonnet seat failed
and the verdict rests on Haiku alone (that verdict is still shown).

**A real domain is needed before going live** with email, Google or Apple
sign-in on the web: Resend cannot send from `sslip.io`, and Google and Apple
want a domain you own for the consent screen and return URLs. Native app
sign-in does not depend on it.

### How a premium verdict is made

1. **Clarifying questions** (`POST /api/v1/clarify`, Haiku, never costs a
   credit): up to 2 short questions when a fact that would change the winner
   is missing. Answers (skipped ones dropped) are appended to the argument
   before names are swapped out.
2. **Web fact-check** (Haiku with Anthropic's `web_search_20250305` tool, up
   to `PREMIUM_FACTCHECK_MAX_SEARCHES` searches, on the anonymized text).
   Only source URLs that really came back from the search are kept; a claim
   with no surviving source is shown as "unverified". Pure values disputes
   are not searched. A failure or a 40 s timeout lets the judges rule without
   it ("unavailable").
3. **Judge panel**: 2 × Sonnet + 1 × Haiku in parallel, each seeing the
   fact-check, then escalation on a low-confidence panel and the crux trial.
4. The verdict is stored anonymized, with `tier`, `fact_check` and `panel`,
   and the reserved credit is consumed (or returned, see above).

### Two-sided cases, evidence and appeals

- **Hear both sides.** Any signed-in user writes their side (`POST /api/v1/cases`)
  and gets a private invite link `/r/<token>` for the other person. That
  person needs no account: they write their side privately (Turnstile when
  configured, per-IP limits). Neither sees the other's text before the
  verdict; afterwards both see the verdict and both anonymized accounts.
  The judges get both accounts labelled "Party A's account" / "Party B's
  account" and add what both agree on, what is disputed (with which side the
  evidence favors and the fact the verdict hinges on) and what would change
  the verdict. The owner can judge with only their side at any time; after
  7 days without an answer the invite expires.
- **One premium verdict per case.** A `"tier"` on create is ignored. The
  case gets the fact-check and the panel for one premium verdict, held when
  the case is created
  (it counts towards the monthly cap and `PREMIUM_DAILY_CAP` then), spent
  when it is judged, and returned if judging fails, the judges decline, or
  nobody answers in 7 days. Judging runs after the response (Next's
  `after()`, so it needs `next start` or a platform that supports it);
  anything still judging after 10 minutes is failed (and a held credit
  refunded). Cases created as free before this (`cases.tier = 'free'`) hold
  nothing and are still judged once without a charge, by the premium panel;
  judging one again after a failure or expiry takes a unit like any case.
- **Evidence.** Up to 3 images per side (1 per appeal), PNG/JPEG/WebP/GIF,
  checked by their bytes. The browser shrinks them to 1600 px first. Each
  image is transcribed in memory by `EVIDENCE_MODEL` and then thrown away:
  images are never stored, and the transcript is anonymized with the same
  name map as the text before it is stored or judged. Works for one-sided
  verdicts too (`"evidence"` on `POST /api/v1/verdict`).
- **Appeals.** After a verdict, each party may add context once (the owner;
  the other person only when signed in with Premium, and only the person who
  wrote side B: the account they answered with, or whoever holds the claim
  code their browser got when answering signed out). It costs one premium
  verdict; the whole case is judged again and the new verdict is labelled
  (verdict stands / flipped / changed) next to the earlier one, which stays.
- **Names.** Each side is anonymized when it is submitted. The judges read
  only the anonymized text; each side as written (with its raw transcripts
  and name map) is stored encrypted, readable only by that party (see
  *Stored originals, names and removal*). Each person types the name they
  want on the share pages when they submit (`displayName`; empty = the
  label). The server also keeps keyed, per-case name fingerprints so the
  same person gets the same label in both accounts.
- **Secrets.** Invite links, evidence tokens and name fingerprints are keyed
  from `BETTER_AUTH_SECRET`: rotating it turns off open invite links and
  pending evidence uploads.
- **Removal.** Either party can remove their own side: their original and
  display name are blanked and every link of the case (share pages, previews,
  the invite) is closed. Nothing is deleted. Deleting an account does this
  for every case the account started or answered.

**Cost per premium verdict** (Haiku $0.10/$0.50 and Sonnet $2/$10 per
million tokens, $0.01 per search). Measured on 6 logged local runs:
**$0.031 to $0.052**, about $0.05 for a factual dispute with 2 searches and
about $0.03 for a values dispute with no search; the two Sonnet seats are
most of it. That is the typical range, not a limit: every model call may
write up to 16k output tokens, so the code allows up to about **$0.43** for
one verdict (anonymize $0.008, fact-check with 3 searches $0.044, two Sonnet
seats $0.34, Haiku seat $0.008, escalation $0.017, crux trial $0.017). Each
clarifying-question call can add up to about $0.008.

**Margins** have to be worked out on what is left after the app store's cut
(Apple and Google keep 15 to 30%), since the mobile app is the main target.
At a 30% cut one credit nets $0.70 (1 for $1.00) or $0.525 (10 for $7.50),
against a typical cost of about $0.04 and a code ceiling of about 3 credits
per verdict. The monthly plan nets $10.50 to $12.75 of its $15.00: at the
cap of 35 a heavy user costs about $1.37 at the measured average ($0.039)
and about $1.82 at $0.052 a verdict. To change that, move the cap
(`PRICING.monthly.fairUseCap` in `lib/pricing.ts`) or the prices, or lower
the per-verdict ceiling (for example a smaller `max_tokens` for the Sonnet
judge calls, whose measured output is 500 to 800 tokens; not done yet).

### Stored originals, names and removal

- **What is stored.** Every submission's text exactly as sent (free and
  premium arguments with Premium's questions and answers, each case side,
  each appeal), the raw screenshot transcripts and the name map (original ->
  label), as one AES-256-GCM sealed JSON blob per submission in the
  `originals` table, bound to its row (the additional authenticated data
  names the row). The judges, fact-check, crux trial and translation still
  only ever get the anonymized text.
- **Who can read it.** Only the writer: a signed-in writer through their
  account on any device; a signed-out writer through an owner token returned
  once in the verdict response (`owner_token`, 43 characters; the website
  keeps it in `localStorage` under `judge.owner.<verdictId>`, the app should
  use secure storage) and sent only as the `X-Owner-Token` header. The server
  keeps a SHA-256 of the token, never the token. Case parties use their
  session, or Party B's claim code. The operator can decrypt with the key
  (`scripts/originals.ts`).
- **Share pages show names.** Each one-sided verdict has display names: the
  other people default to the first names the writer used, the writer's own
  name is whatever they save in the share dialog (prefilled with the
  account's first name). The writer can edit them or switch names off at any
  time (then the page shows Party A / Party B). Share pages and their OG
  images use only these display names, never the raw map, and stay
  `noindex`.
- **Removal.** The writer (or a case party for their side, or account
  deletion for everything of an account) can remove a verdict: the original,
  name map and display names become NULL, and the share page (via
  `proxy.ts`), its preview image and `GET /api/v1/verdicts/{id}` answer
  **410**. No row is ever deleted; the anonymized text and the verdict stay
  in the database, unreachable through public routes.
- **Key rotation.** Put the new key in `ORIGINALS_KEY` and move the old one
  to `ORIGINALS_KEY_PREVIOUS` (comma-separated); new data is sealed with the
  new key, old data stays readable through the previous ones. Nothing is
  re-sealed. That includes the Sign in with Apple refresh tokens kept for
  revocation (`signin_tokens`): a token is only refreshed at the account's
  next Apple sign-in, so drop an old key only once no token sealed with it
  remains. A token that cannot be opened is not revoked at Apple when its
  account is deleted (logged, recorded as `failed` in the removal log).
- **Older rows.** Verdicts stored before this feature have no owner and keep
  showing labels. Premium verdicts (linked through their consumed credit)
  and case verdicts are backfilled with an ownership row at startup.

**Operator script** (from the app directory; `show*` needs the key):

```bash
sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/originals.ts show <verdictId>
sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/originals.ts show-case <caseId> [a|b]
sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/originals.ts remove <verdictId>
sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/originals.ts remove-case <caseId> <a|b>
```

`remove` also works for verdicts stored before this feature (it adds a
removed ownership row). Every removal (by a writer, a party, an account
deletion or this script) is also appended to the removal log (`REMOVAL_LOG`,
by default `removals.log` beside the database, i.e.
`/var/lib/verdict/removals.log` on the server). Restoring an older database
would otherwise bring removed originals and share links back, so
`verdict-restore` runs
`scripts/originals.ts replay-removals [logFile]` before starting the app
(and leaves it stopped if that fails); run it by hand after any other kind
of restore. A server installed before this feature needs
`ORIGINALS_KEY` added to its env file by hand (`openssl rand -base64 32`)
and a restart; until then nothing personal is stored (logged once).

### Try it locally (test sign-in)

```bash
# in .env: DEV_LOGIN=1
npm run dev:login -- -p 3600
# open http://127.0.0.1:3600/signin and use the test sign-in button
npx tsx --env-file=.env scripts/grant.ts test@verdict.local --credits 5
```

### Give testers Premium (admin script)

```bash
npx tsx --env-file=.env scripts/grant.ts <email> --credits 20
npx tsx --env-file=.env scripts/grant.ts <email> --subscription 30d
npx tsx --env-file=.env scripts/grant.ts <email> --revoke
npx tsx --env-file=.env scripts/grant.ts <email> --show
```

The person must have signed in once; add `--create` to make the account
first. Every change is recorded in the grant ledger with source `admin`, and
the resulting balance is printed. On the Lightsail server, from the app
directory: `sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/grant.ts <email> --credits 20`.

### API for mobile

The website and the future iOS/Android app share one JSON API. Base URL
`https://<domain>/api/v1`; changes within v1 are additive only.

- **Auth:** `Authorization: Bearer <session token>`. No cookies or CORS
  needed for native apps; the website uses the HttpOnly cookie
  `verdict.session_token` for the same session. Cookie-authenticated
  writes must come from the site's own origin (`403 bad_origin`), bearer
  requests are exempt.
- **Errors:** `{ "error": "<English>", "code": "<stable code>", "retryAfterSec"?, "resetsAt"? }`.
  Codes are listed in `lib/api-errors.ts`; the app localizes them with the
  `error.<code>` keys in `lib/i18n.ts`.
- **Shared plain-TypeScript modules** (no Next or DOM imports) the app can
  reuse: `lib/types.ts`, `lib/i18n.ts`, `lib/verdict-display.ts`,
  `lib/names.ts`, `lib/palette.ts`, `lib/frameworks.ts`, `lib/api-errors.ts`,
  `lib/account-types.ts`, `lib/pricing.ts`, `lib/case-types.ts`,
  `lib/originals-types.ts`, `lib/verdict-poll.ts`.

| Call | Purpose |
|---|---|
| `GET /api/v1/config` | Startup: which sign-in methods work, whether Premium is on, prices, `freeTier: false` and `welcomeCredits` (`AppConfig`) |
| `GET /api/v1/me` | The account and its entitlement (`MeResponse`); signed out = `{ "user": null, "entitlement": null }`; a dead bearer token = `401 signin_required` |
| `DELETE /api/v1/me` `{ "confirm": "delete" }` | Removes every verdict the account owns and its side of every case (originals and names blanked, links closed; no verdict row is deleted), then deletes the account, sessions, sign-ins and entitlements (both stores require in-app deletion). Stored Sign in with Apple tokens are revoked at Apple first; an Apple failure is logged and does not stop the deletion |
| `POST /api/v1/auth/apple/code` `{ "code": "<authorizationCode>" }` | iOS, right after a native Sign in with Apple: lets the server keep the Apple refresh token so account deletion can revoke it. `200 { "stored": true }` |
| `GET /api/v1/me/verdicts` | Your one-sided verdicts, newest first (`?limit=1-50&before=<createdAt>`), each with its anonymized `headline` and your `nameMap` to restore names |
| `POST /api/v1/clarify` | Premium: up to 2 clarifying questions |
| `POST /api/v1/verdict` | A verdict (signed in; one premium unit; `401 signin_required` signed out, `402 no_credits` / `fair_use` without a unit). `"tier"` is accepted and ignored. Send an `Idempotency-Key` header to retry safely. Adds `originals_stored`, `display`, `suggested_display_a` and `entitlement`. With `Prefer: respond-async`: `202`, then poll (see *Async verdicts* below) |
| `GET /api/v1/verdicts/{id}` | A stored verdict (`"status": "ready"`), with `display` (the share page's names, null = labels); `410 removed` once removed. An async verdict still judging or failed answers `"status": "judging"` / `"failed"` |
| `GET /api/v1/verdicts/{id}/mine` | The writer's view (session or `X-Owner-Token`): `original` as written, `nameMap`, `display`, `originalStatus` (`stored`, `not_stored`, `removed` or `unreadable`); 404 for anyone else |
| `PATCH /api/v1/verdicts/{id}/display` | Writer: `{ "namesVisible"?, "a"?, "b"?, "others"?: { "Person C": "Leo" } }` (null = the label; labels such as "Party A" refused); `503 names_unavailable` for names when the server has no key |
| `POST /api/v1/verdicts/{id}/removal` | Writer: `{ "confirm": "remove" }` blanks the original and names and closes the link (idempotent) |
| `POST /api/v1/verdicts/{id}/claim` | Signed in + `X-Owner-Token`: keep a token-owned verdict in the account |
| `POST /api/v1/verdicts/{id}/translate?lang=en\|tr` | A stored verdict in the other language |
| `POST /api/v1/auth/dev-login` | Local testing only (see above); 404 everywhere else |
| `POST /api/v1/evidence` | Premium: transcribe 1 to 3 evidence images, get signed evidence tokens |
| `POST /api/v1/cases` | Start a two-sided case (signed in; holds 1 premium verdict; `"tier"` is ignored) |
| `GET /api/v1/cases` | Your cases, newest first (`?limit=1-50&before=<createdAt>`); each has the anonymized `headline` of its latest verdict and an `excerpt` of your side |
| `GET /api/v1/cases/{id}` / `DELETE` | Your case (`CaseView`) / remove your side (kept for older clients; same as `/removal`) |
| `GET /api/v1/cases/{id}/originals` | Your side (and appeal) as you wrote them |
| `PATCH /api/v1/cases/{id}/display` | `{ "displayName"?, "namesVisible"? }`: your name on the share pages and the names switch |
| `POST /api/v1/cases/{id}/removal` | `{ "confirm": "remove" }`: removes your side and closes every link of the case (`409 in_progress` while judging) |
| `POST /api/v1/cases/{id}/judge` | Judge with only your side (`{ "mode": "only_mine" }`), or retry a failed case |
| `POST /api/v1/cases/{id}/invite` | A new invite link (the old one stops working) |
| `POST /api/v1/cases/{id}/appeals` | Add context once and get a re-judged verdict (1 premium verdict) |
| `GET /api/v1/respond/{token}` / `POST` | The invite as the other person sees it / their side (no account) |
| `POST /api/v1/respond/{token}/evidence` | The other person's evidence images |
| `POST /api/v1/respond/{token}/appeals` | The other person adds context (signed in, Premium) |
| `POST /api/v1/webhooks/revenuecat` | RevenueCat only (`Authorization: Bearer ${REVENUECAT_WEBHOOK_SECRET}`): applies a purchase event once; see *Purchases* |
| `GET /api/v1/respond/{token}/originals` / `PATCH .../display` / `POST .../removal` | Party B (bound account or `Respondent-Claim` / `claim`): their original, their display name, removing their side |

**Async verdicts (use these in the apps).** The site sits behind
Cloudflare, which ends any request after 100 seconds (HTTP 524), and a
verdict can take longer (escalation, the crux trial, a premium panel with
fact-check). The server still finishes and stores such a verdict, but a
waiting client never learns its id. So ask for the async flow; requests
without it keep the old behavior (the response arrives when the verdict is
done), so older pages and app builds keep working.

1. **Request:** `POST /api/v1/verdict` as before, plus the header
   `Prefer: respond-async` (or `"async": true` in the JSON body), with its
   `Idempotency-Key`.
   Everything that can refuse the request still answers at once with the
   usual status and `code`: validation, rate limits and caps,
   sign-in, credits (the unit is reserved now) and anonymization (`503
   unavailable` when a name cannot be taken out; nothing is judged or
   stored, and a reserved unit is refunded).
2. **Accepted:** `202` with headers `Location: /api/v1/verdicts/{id}`,
   `Retry-After: 2`, `Preference-Applied: respond-async` and the body
   `VerdictAcceptedResponse` (`lib/verdict-poll.ts`):
   `{ "id", "status": "judging", "pollAfterMs": 2000, "poll": "/api/v1/verdicts/{id}", "name_map": [...], "owner_token"?, "suggested_display_a"?, "entitlement"? }`.
   Keep `name_map` and `owner_token` now (secure storage for the token):
   the poll does not repeat them. `entitlement` (premium) is the balance
   with this verdict's unit reserved. A premium retry with the same
   `Idempotency-Key` (and `Prefer: respond-async`) while it is judging
   answers `202` with the same `id`, `"replayed": true` and an empty
   `name_map` (read the names from `GET /api/v1/verdicts/{id}/mine` once
   it is ready); after it finished, `200` with the stored verdict (as
   before). While the first request is still being anonymized (up to about
   a minute) the retry gets `409 in_progress`: wait a few seconds and retry
   with the same key. Handle a plain `200` verdict too: the server may
   answer synchronously (e.g. an older server).
3. **Poll:** `GET /api/v1/verdicts/{id}` (send `X-Owner-Token` or the
   bearer token if you have one). Always `200` for these states:
   - `{ "id", "status": "judging", "pollAfterMs": 2000 }` (+ `Retry-After: 2`): poll again;
   - `{ "id", "status": "ready", "result", "createdAt", "display", "owner"? }`: done.
     `owner` (`{ "originals_stored", "display": { namesVisible, a, b, others } }`)
     is only there for the writer (owner token or owning session); it fills
     the same fields the synchronous response had;
   - `{ "id", "status": "failed", "code", "error" }`: stop and show the
     localized `error.<code>` message. `code` is `quota` (the AI quota is
     used up for now) or `unavailable` (the judges failed, saving failed,
     or the verdict was still judging after 10 minutes, e.g. a server
     restart); `refused` is reserved. A failed premium verdict's unit is
     refunded. A refusal by the model is not a failure: it arrives as a
     ready verdict with `model_refused: true` (premium: refunded), as before.

   Other answers: `404 not_found` (unknown id: stop), `410 removed` (stop),
   `429 rate_limited` (per address, about 600 polls per 10 minutes; wait
   `Retry-After`), `503 unavailable` or a network error (keep polling).
4. **Backoff** (what `pollVerdict` in `lib/verdict-poll.ts` does): first
   poll after `pollAfterMs` (2 s), then x1.5 per poll up to 5 s; after an
   error double the wait up to 15 s; a larger `pollAfterMs` or
   `Retry-After` always wins. Drop a poll that takes longer than 20 s
   (request and body) and count it as a network error, so a dead
   connection cannot stall polling. Poll right away when the app returns
   to the foreground or the network comes back. Give up after 11 minutes; the
   server fails a verdict still judging after 10, so you normally hear
   `failed` first.

**Two-sided cases from the app.** Shapes are in `lib/case-types.ts` (a pure
module the app can import); every case and respond response is
`Cache-Control: no-store`.

1. *(Optional)* **Evidence:** `POST /api/v1/evidence` with `multipart/form-data`
   (1 to 3 parts named `image`) or JSON
   `{ "images": [{ "data": "<base64>", "mediaType": "image/jpeg" }] }`. Shrink
   images to 1600 px on the longest edge first (max 5 MB each, 16 MB per
   request). The answer lists each image:
   `{ "items": [{ "index": 0, "status": "ok", "kind": "chat", "token": "v1....", "preview": "...", "expiresAt": "..." }] }`;
   `status` is `ok | unreadable | refused | unsupported | too_large | failed`.
   `preview` is the raw transcript for the uploader only (it may contain real
   names; show it, never send it anywhere). Tokens expire after 6 hours and
   are bound to who uploaded (your account, or for the other person, the
   case). One bad image does not fail the request; whole-request errors are
   `413 too_large` (body over 16 MB), `415 unsupported_media` (not multipart
   or JSON), `400 too_many_files` (more than 3) and the usual premium,
   sign-in and rate-limit codes. Phone numbers, e-mail addresses, handles and
   account numbers are masked when the transcript is anonymized.
2. **Create:** `POST /api/v1/cases` with an optional `Idempotency-Key` and
   `{ "text": "...", "framework": { "preset": "balanced" }, "lang": "en", "evidence": ["v1...."] }`.
   A `"tier"` is ignored; `case.tier` is `"premium"` (`"free"` only on cases
   from before every verdict was premium). Add `"displayName": "Aytu"` for the name shown on the share
   pages (empty or absent = Party A).
   `201 { "case": CaseView, "name_map": [...], "entitlement": {...} }`
   (`200` with `"replayed": true` and an empty `name_map` on a retried key).
   The server keeps an encrypted copy of the name map (`case.names` on every
   later `GET`, on any device); keeping `name_map` locally is only a fallback
   for a server without `ORIGINALS_KEY`. Share `case.inviteUrl`.
3. **Status:** `GET /api/v1/cases/{id}`. While `case.pollAfterMs` is set
   (something is judging), poll again after that many milliseconds.
   `status`: `awaiting_respondent | judging | judged | failed | expired`.
   `case.canJudgeNow` says whether `POST /cases/{id}/judge` makes sense
   (`{ "mode": "only_mine" }` while waiting for the answer; no body needed to
   retry a failed case; an expired or failed case takes a new unit). `202`
   when judging
   started, `200` when it already was.
4. **The other person** opens `https://<domain>/r/<token>` (or the app calls
   `GET /api/v1/respond/{token}`), then `POST /api/v1/respond/{token}` with
   `{ "text": "...", "evidence": ["v1...."], "turnstileToken": "...", "displayName": "Deniz" }`
   (Turnstile is skipped for bearer sessions). `202 { "case": CaseView, "name_map": [...] }`;
   store that `name_map` too. A signed-in answer binds side B to that
   account. A signed-out answer also returns `"respondent_claim": "<22 chars>"`
   (again on a replayed `Idempotency-Key`): keep it in secure storage with
   the name map. It is the only proof of having written side B; send it as
   the `Respondent-Claim` header on `GET /api/v1/respond/{token}` (so
   `case.appeal` is right for this person) and as `"claim"` on the appeal.
   Anyone else holding the link gets `not_party`. Their evidence goes to
   `POST /api/v1/respond/{token}/evidence`.
5. **Verdicts:** `case.verdicts` (oldest first; the last is current) carry
   the usual `VerdictResult` plus `two_sided`, `agreed_facts`,
   `disputed_facts` (`fact`, `party_a`, `party_b`, `finding` `a|b|unsettled`,
   `decisive`), `would_change`, `evidence_used` and, after an appeal,
   `appeal` (`by`, `outcome` `upheld|overturned|changed`, `previous_id`,
   `previous_verdict`, `previous_confidence`, `confidence_change`, `summary`).
   `case.sides` holds both anonymized accounts once a two-sided verdict
   exists (before that: only the owner's own side, and nothing on the
   respondent view). Each verdict also has a public share link `/v/<id>`.
6. **Appeal:** `case.appeal.allowed` / `blockedBy`
   (`signin_required | premium_required | no_credits | fair_use | appeal_used | not_judged | busy | not_party`).
   `POST /api/v1/cases/{id}/appeals` (owner) or
   `POST /api/v1/respond/{token}/appeals` (signed-in respondent) with
   `{ "text": "20 to 2000 characters", "evidence": ["v1...."], "claim": "..." }`
   (at most 1 image; `claim` only for the respondent, until their account is
   bound by the first accepted appeal) and an optional `Idempotency-Key`.
   `202`, then poll. The appeal outcome stays `upheld | overturned | changed`
   in the API; the website shows it as "Verdict stands / flipped / changed".
   On the web, "Sign in to add context" returns to `/r` (never `/r/<token>`):
   the token is kept in the browser so it is not put in a sign-in e-mail or
   an OAuth state.

Removal and names: `removed` (410: the verdict or case was removed; its
links no longer work) and `names_unavailable` (503: a display name was sent
while the server has no originals key). `CaseView` also carries `names`
(your own map, or null), `display` (`namesVisible`, `a`, `b`), `removed`
(`{ at, parties }` or null) and `yourOriginal`; a removed side's entries
have `text: ""`, `evidence: []` and `removed: true`.

Case error codes: `case_closed` (409), `case_expired` (410), `appeal_used`
(409), `in_progress` (409), `not_party` (403), `own_case` (403),
`too_many_files` (400), `evidence_invalid` (400), `too_large` (413),
`unsupported_media` (415), `anonymize_failed` (503: a name could not be
taken out of the text; the same request can be retried, e.g. with initials), plus the premium ones (`signin_required`,
`premium_required`, `no_credits`, `fair_use`, `rate_limited`, `daily_cap`,
`not_configured`). `GET /api/v1/config` has
`features: { cases, evidence }` (absent on older servers: treat as false).

**Sign-in from the app** (Better Auth endpoints under `/api/auth`):

- **Apple (iOS):** `expo-apple-authentication` with a random nonce (Apple gets
  its SHA-256), then `POST /api/auth/sign-in/social`
  `{ "provider": "apple", "idToken": { "token": "<identityToken>", "nonce": "<raw nonce>", "user": { "name": { "firstName": "…", "lastName": "…" } } } }`.
  Apple sends the name only on the first sign-in, so pass it then. Needs
  `APPLE_APP_BUNDLE_ID`. Right after that sign-in succeeds, send the
  credential's `authorizationCode` with the new bearer token:
  `POST /api/v1/auth/apple/code { "code": "<authorizationCode>" }` →
  `200 { "stored": true }`. The server exchanges it with Apple and keeps the
  refresh token (sealed) only to revoke it when the account is deleted. Codes
  are single-use and expire within minutes, so send it at once, on every
  Apple sign-in. A failure (`400 invalid`, `429 rate_limited` with
  `Retry-After`, `503 unavailable` or `not_configured`) never undoes the
  sign-in; the app may ignore it. Limit: 10 per 10 minutes and 30 per day per
  account.
- **Google (iOS/Android):** native Google Sign-In, then
  `POST /api/auth/sign-in/social { "provider": "google", "idToken": { "token": "<idToken>" } }`.
  Needs the iOS/Android client ids above.
- Both answer `200 { "redirect": false, "token": "<session token>", "user": { … } }`
  (also in the `set-auth-token` header); keep the token in the device's secure
  storage. An invalid ID token answers `401 { "code": "INVALID_TOKEN" }`.
- **Session:** `GET /api/v1/me`. **Sign out:** `POST /api/auth/sign-out` with
  the bearer token. Sessions last 30 days and slide forward with use.
- **Dead tokens:** a bearer token that matches no live session (unknown,
  expired, signed out, account deleted) answers `401` with code
  `signin_required` on every route that reads the session, before any other
  work (`{ "error": "Sign in first.", "code": "signin_required" }` where the
  route would otherwise serve a signed-out caller): `POST /api/v1/verdict`,
  `GET /api/v1/verdicts/{id}` (polls and share reads),
  `GET /api/v1/me`, the writer and respondent routes, and every route that
  needs an account. Drop the token and sign in again. Requests without an
  `Authorization` header (the website, share viewers) are unaffected; an
  expired cookie still counts as signed out.
- **Email (apps): a 6-digit code**, offered when `signIn.emailCode` is true
  in `GET /api/v1/config` (false, and both endpoints `404`, without
  `RESEND_API_KEY`/`EMAIL_FROM`):
  1. `POST /api/auth/email-otp/send-verification-otp?lang=tr`
     `{ "email": "a@example.com", "type": "sign-in" }` → `200 { "success": true }`
     and an email with the code (`lang=tr` Turkish, otherwise English). Only
     `"type": "sign-in"` is accepted (`400` otherwise).
  2. `POST /api/auth/sign-in/email-otp { "email": "a@example.com", "otp": "123456" }`
     → `200 { "token": "<session token>", "user": { … } }` (also in the
     `set-auth-token` header). A new address gets a new account.
  Codes work once for 10 minutes. Wrong code: `400 { "code": "INVALID_OTP" }`;
  after 3 wrong codes the code is burned: `403 { "code": "TOO_MANY_ATTEMPTS" }`;
  late: `400 { "code": "OTP_EXPIRED" }`. Both endpoints allow 3 requests per
  minute per IP (`429`). No Turnstile token is needed.

### Purchases

The apps sell through the App Store and Google Play with RevenueCat; the
server is the source of truth for what a purchase grants, so no RevenueCat
entitlement has to be set up (products only).

1. **Products** (App Store Connect and Play Console, then imported into
   RevenueCat): `pack_1` (consumable, 1 credit), `pack_10` (consumable, 10
   credits), `monthly` (auto-renewing monthly subscription; on Google Play any
   base plan id works, `monthly:<base plan>` is read as `monthly`). These are
   the ids in `STORE_PRODUCTS` (`lib/pricing.ts`).
2. **Webhook** (RevenueCat → Integrations → Webhooks): URL
   `https://okjudge.com/api/v1/webhooks/revenuecat`, Authorization header
   `Bearer <REVENUECAT_WEBHOOK_SECRET>`, production events (sandbox events
   are ignored unless `ALLOW_SANDBOX_PURCHASES=1`).
3. **App:** `Purchases.logIn(user.id)` with our account id before buying,
   then refresh `GET /api/v1/me` after a purchase.
4. Set `PURCHASES_ENABLED=1` when the products are live.

Every event the server has decided about answers `200`: applied
(`{ "ok": true, "applied": true|false, "action": "<StoreEvent type>" }`,
`applied: false` = already applied or nothing to apply it to), or ignored
(`{ "ok": true, "ignored": true, "reason" }`, e.g. `unknown_product`,
`unknown_user`, `sandbox`); the `TEST` event answers
`{ "ok": true, "test": true }`. `401` wrong secret, `400`/`413` malformed or
over 256 KB, `429` over 600 requests per 10 minutes per IP, `503` not
configured or the database failing (RevenueCat retries for about 80
minutes). Each purchase is granted at most once, whatever RevenueCat
retries or replays:

| RevenueCat event | Result |
|---|---|
| `NON_RENEWING_PURCHASE` (or `INITIAL_PURCHASE`) of a pack | `credits_purchased`: the pack's credits, once per `transaction_id` |
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE` of the plan | `subscription_active`: period `purchased_at_ms` to `expiration_at_ms`, renewing; a new period resets the fair-use count |
| `CANCELLATION` of the plan, any reason but `CUSTOMER_SUPPORT` | `subscription_will_not_renew`: access stays until the period ends |
| `CANCELLATION` with `cancel_reason: CUSTOMER_SUPPORT` (a refund) | `refund`: a pack's credits are taken back (never below 0); the plan ends at once |
| `EXPIRATION` of the plan | `subscription_expired` at `expiration_at_ms` (ignored after a later renewal) |
| `TEST` | `{ ok, test }`, nothing changes |
| `BILLING_ISSUE`, `SUBSCRIPTION_PAUSED`, `TRANSFER`, a pack `CANCELLATION` that is not a refund, any other type | ignored |

Stores: `APP_STORE`/`MAC_APP_STORE` → `app_store`, `PLAY_STORE` →
`play_store`, `STRIPE`/`RC_BILLING`/`PADDLE` → `web`; others are ignored.
The buyer is the first existing account among `app_user_id`,
`original_app_user_id` and `aliases` (anonymous RevenueCat ids never match).
`applyStoreEvent()` in `lib/entitlements.ts` is the single entry point, so a
direct web provider can map its own webhook to the same `StoreEvent` union.
Apple's rule for multiplatform services: credits or plans bought on the web
may be used in the iOS app only if the same items are also sold as in-app
purchases there.

## Deploy to AWS Lightsail

One small Linux server runs everything: the app, its SQLite database file,
and [Caddy](https://caddyserver.com) for HTTPS. Besides AWS you only need
your Anthropic API key, and the code on GitHub at
`github.com/aytutuna/Judge` (public). No Turso, Upstash or Cloudflare
account is needed: verdicts are stored on the server's disk, and rate limits
are counted in the app's memory and logged to a small file in `/run`, so
restarts and deploys keep them (a reboot of the server resets them). That
works because exactly **one** app process runs. Never start a second copy of
the app or put several servers behind a load balancer: each copy would have
its own limits.

Step 0 and every later deploy need git on your computer (from
[git-scm.com](https://git-scm.com), or [GitHub Desktop](https://desktop.github.com));
everything else happens in a web browser.

### 0. Put the whole app on `main`

The server clones the `main` branch, and it needs the complete current app
on it, not just the `deploy/` folder: the `/api/health` check, the rate
limits, the bot check and the libSQL storage all came after the first
commits. Pushing only `deploy/` to an older `main` gives a server that
builds the old app, fails its health check and stops with an error.

If you made these changes on another branch (this guide was written on
`public-launch`), commit everything on it (`git status` should say
*nothing to commit*), then merge it into `main` and push, in a terminal in
the project folder:

```bash
git checkout main
git pull origin main
git merge public-launch
git push origin main
```

Or push the branch (`git push origin public-launch`), open a pull request
into `main` on github.com, and choose **Merge pull request**. Either way,
check on github.com that `main` now has `deploy/aws-lightsail/setup.sh` and
`app/api/health/route.ts`. If it does not, setup stops early and says so.

### 1. Create an AWS account

1. On [aws.amazon.com](https://aws.amazon.com) choose **Create an AWS
   account** and follow the steps (a payment card is required).
2. Pick a plan. The **Free plan** gives new accounts $100 in credits (up to
   $200 as you try services), but it ends after 6 months or when the credits
   run out, and then AWS suspends the account and the site goes offline until
   you upgrade. For a site that should stay up, choose the **Paid plan** (new
   accounts get the credits there too) or upgrade before the 6 months end.
3. Lightsail adds a free trial on the $5 plan. AWS's guide currently says one
   free month (750 hours); some offers have been three months. When the trial
   ends, billing starts on its own (on day 91 for the three-month offer), with
   no reminder. To get an email before costs grow, create a monthly budget in
   [AWS Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/).

### 2. Create the server

1. Open the [Lightsail console](https://lightsail.aws.amazon.com) and choose
   **Create instance**.
2. Instance location: keep the suggested Region, or choose **Change AWS
   Region and Availability Zone** to pick one near your visitors.
3. Platform: **Linux/Unix**. Blueprint: **OS Only**, then **Ubuntu 24.04 LTS**.
4. Plan: keep the networking type that includes IPv4 (dual-stack) and pick
   the **$5 USD** plan (512 MB memory, 2 vCPUs, 20 GB SSD, 1 TB transfer).
   Do not pick the $3.50 IPv6-only plan: it has no IPv4 address, so visitors
   whose home, office or mobile network has no IPv6 could not open the site,
   and the free `sslip.io` address in step 4 needs IPv4.
5. Name it, e.g. `verdict`, and choose **Create instance**. Wait until it
   shows *Running*.

### 3. Fix its address and open HTTPS

1. **Static IP.** The default public IP changes whenever the server stops.
   In the Lightsail console's left menu choose **Networking**, then **Create
   static IP**, select your instance, name it, and choose **Create**. A static
   IP is free while it is attached to an instance (unattached ones are
   billed, so release it if you ever delete the server).
2. **Firewall.** Open your instance (click its name), go to the
   **Networking** tab, and under **IPv4 Firewall** choose **Add rule**,
   Application **HTTPS**, then **Create**. Do the same under **IPv6
   Firewall**. SSH (22) and HTTP (80) are already allowed; keep HTTP, because
   Caddy uses it to obtain the certificate and to redirect visitors to HTTPS.

### 4. Choose the site address

- **Your own domain (optional):** at your domain registrar, add a DNS
  **A record** for the name you want (e.g. `verdict`, or `@` for the bare
  domain) with the static IP as its value. Do this before step 5 and give it
  a few minutes to take effect.
- **No domain:** skip this step. Setup offers an address like
  `203-0-113-10.sslip.io` (your static IP with dashes). [sslip.io](https://sslip.io)
  is a free public DNS service that points such names at the IP inside them,
  so HTTPS works without buying a domain. You can move to a real domain later
  (see *Change the site address* below).
- **A domain on Cloudflare with its proxy on (orange cloud):** follow
  *Custom domain behind Cloudflare* below; without those settings every
  visitor would share Cloudflare's few addresses and the rate limits with them.

### 5. Run the setup

1. In the Lightsail console, open your instance and choose **Connect using
   SSH** (on the **Connect** tab). A terminal opens in the browser.
2. To paste into it: copy the text on your computer, choose the clipboard
   icon in the terminal window, paste into its text box with Ctrl+V, then
   right-click the terminal. Paste and run this line:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/aytutuna/Judge/main/deploy/aws-lightsail/setup.sh -o setup.sh && sudo bash setup.sh
   ```

3. Answer its two questions: the site address (press Enter for the
   `sslip.io` address) and your Anthropic API key (the key stays hidden while
   you paste it, and is saved in `/etc/verdict/verdict.env`, readable only
   by root).
4. Wait. Setup adds a 2 GB swap file (the build needs more than 512 MB of
   memory), installs Node.js 24, Caddy and automatic security updates,
   creates a `verdict` system user, clones the code, builds it, and starts
   it. The first build takes 5 to 15 minutes on this plan. At the end it
   prints your site's address. On a brand-new server it may first wait a few
   minutes for Ubuntu's own start-up updates to finish.

   **If setup stops with an `ERROR`,** read the line above it, fix the cause
   if it names one, and run the same `curl ... && sudo bash setup.sh` line
   again: finished steps are skipped and your answers are kept. If the build
   ran out of memory (`JavaScript heap out of memory` or `Killed`), give it
   a bigger swap file and run setup again:
   `sudo SWAP_SIZE=3G bash /opt/verdict/repo/deploy/aws-lightsail/setup.sh`.
5. Open the address, submit an argument, and check that the share link
   `/v/<id>` loads. If the browser warns about the certificate right after
   setup, wait a minute and reload (with a new domain, until its DNS points
   at the server).

### 6. Set a hard spend limit

In the [Anthropic Console](https://console.anthropic.com/settings/billing),
under **Spend limits**, choose **Set limit** (or **Adjust limit**) and enter
the most you are willing to spend per month, so a bug or an attack can never
cost more than that.

### Running it

All commands run in the browser SSH window (**Connect using SSH**).

- **Deploy a change:** push it to `main` on GitHub (e.g. `git push` from your
  computer), then on the server run `sudo verdict-update`. It builds the new
  code next to the running site, switches over only if the build succeeds,
  and checks `/api/health`; if the new version does not answer, it switches
  back to the previous one, with its service and web server settings,
  automatically. A restart first lets verdicts still being judged finish
  (up to about 5 minutes); new requests are refused until the new version
  is up.
- **Logs:** `sudo journalctl -u verdict -f` (Ctrl+C to stop). Caddy and
  certificates: `sudo journalctl -u caddy -n 50`.
- **Status / restart:** `systemctl status verdict`,
  `sudo systemctl restart verdict`.
- **Settings:** `sudo nano /etc/verdict/verdict.env` (save with Ctrl+O,
  Enter; exit with Ctrl+X). After changing `NEXT_PUBLIC_*` or
  `CONTACT_EMAIL`, which are baked in at build time, run
  `sudo verdict-update --force`; after anything else,
  `sudo systemctl restart verdict`. Each setting is one `KEY=value` line;
  type the value right after the `=`, with no spaces or quotes. Lines that
  start with `#` are notes and are ignored, so a value typed on such a line
  does nothing.
  - Set `CONTACT_EMAIL` before you announce the site, so the privacy page
    says where to send removal requests. Change `CONTACT_EMAIL=` to e.g.
    `CONTACT_EMAIL=you@yourdomain.org`, then run `sudo verdict-update --force`.
  - For the optional Turnstile bot check, add your site's host name to a
    Turnstile widget in Cloudflare and paste its two keys after
    `NEXT_PUBLIC_TURNSTILE_SITE_KEY=` and `TURNSTILE_SECRET_KEY=`, then run
    `sudo verdict-update --force`.
- **Change the site address:** point the new domain's A record at the static
  IP, then run
  `sudo bash /opt/verdict/repo/deploy/aws-lightsail/setup.sh --reconfigure`
  (it also asks whether the domain is behind Cloudflare's proxy). Or change
  `NEXT_PUBLIC_SITE_URL` in the settings file yourself and run
  `sudo verdict-update --force`. For a domain on Cloudflare, see
  *Custom domain behind Cloudflare* below.
- **Backups:** every night a copy of the database goes to
  `/var/lib/verdict/backups` (14 days are kept). Run one now with
  `sudo systemctl start verdict-backup`. `sudo verdict-restore` lists the
  backups, and `sudo verdict-restore <file name>` restores one (verdicts saved
  after that backup are lost; the replaced database is kept beside it and,
  like the backups, deleted after 14 days). The restore re-applies every
  removal made since the backup from `/var/lib/verdict/removals.log` (see
  *Stored originals, names and removal*). These copies live on the same
  disk, so also turn on off-server backups: on your instance's **Snapshots**
  tab, switch on **Automatic snapshots** (Lightsail keeps the last seven
  daily snapshots; they are billed per GB stored). The privacy page promises
  removed data is gone from backups within 14 days: keep backup and
  snapshot retention at 14 days or less. A snapshot holds the database *and*
  `/etc/verdict/verdict.env` with `ORIGINALS_KEY`, so the encryption does not
  protect a snapshot: guard snapshots like the server itself. Restoring a
  snapshot also rolls the removal log back, so before restoring one onto a
  new instance, copy `/var/lib/verdict/removals.log` off the old instance
  and run `replay-removals <that file>` on the new one before opening it.
- **Reboots:** if the terminal says *System restart required* after security
  updates, run `sudo reboot`; the app and Caddy start again on their own.
  A restart or reboot starts the rate limits over; the daily cap is counted
  from the database and carries on.

Where things live: code in `/opt/verdict/repo` (owned by root, so the app
and the packages its build runs cannot change what root runs), builds in
`/opt/verdict/releases` (the live one is linked as `/opt/verdict/current`),
settings in `/etc/verdict/verdict.env`, the database in
`/var/lib/verdict/verdict.db`, and the scripts in `deploy/aws-lightsail/`.
The app listens only on `127.0.0.1:3000`; Caddy is the only way in, and it
replaces any `X-Forwarded-For` header a visitor sends with their real address.

### Custom domain behind Cloudflare

With a domain on Cloudflare (bought there, or moved there) you can turn on
Cloudflare's proxy, the orange cloud next to a DNS record. Visitors then
connect to Cloudflare, and Cloudflare connects to your server. That blocks
large attacks before they reach the server, hides its IP address, and serves
static files from near the visitor. The server has to know about it, though:
otherwise every visitor looks like one of a few Cloudflare addresses, and they
all share one rate limit. The steps below use `okjudge.com`; put your own
domain in its place.

**1. DNS records.** In the Cloudflare dashboard, open the domain, then
**DNS** > **Records**. Delete any old `A`, `AAAA` or `CNAME` records for `@`
and `www` (e.g. a registrar's parking page), then add:

| Type | Name | Content | Proxy status |
|---|---|---|---|
| `A` | `@` | the server's IPv4 address (the static IP) | Proxied (orange) |
| `AAAA` | `@` | the server's IPv6 address, if it has one | Proxied (orange) |
| `CNAME` | `www` | `okjudge.com` | Proxied (orange) |

The `AAAA` record is optional: Cloudflare answers visitors over IPv6 either
way, and the record only lets Cloudflare reach the server over IPv6 too. On
Lightsail the address is on the instance's **Networking** tab; skip the record
if there is none.

**2. Cloudflare settings.**

- **SSL/TLS** > **Overview**: set the mode to **Full (strict)**. Cloudflare
  then checks the server's own certificate, which Caddy gets from Let's
  Encrypt. Never use *Flexible*: it sends visitors' data unencrypted to the
  server and makes the site redirect in a loop.
- **SSL/TLS** > **Edge Certificates**: turn **Always Use HTTPS** off. Let's
  Encrypt checks the domain over plain `http://` on port 80, and Caddy has to
  answer that itself. Visitors still end up on `https://`, because Caddy
  redirects them.
- **Security** > **Bots**: turn **Bot Fight Mode** off. It shows challenges
  that the API and mobile apps cannot solve, and on the free plan it cannot
  be switched off for single paths. The Turnstile bot check keeps working.

**3. Server settings.** In the browser SSH window run
`sudo nano /etc/verdict/verdict.env` and set these lines (add any that are
missing):

```bash
NEXT_PUBLIC_SITE_URL=https://okjudge.com
SITE_ALIASES=www.okjudge.com
LEGACY_HOSTS=51-195-110-113.sslip.io
CLOUDFLARE_PROXY=1
```

- `SITE_ALIASES` lists other names of the site, separated by spaces or
  commas; each one redirects to the address in `NEXT_PUBLIC_SITE_URL`.
- `LEGACY_HOSTS` lists old addresses that should redirect the same way, here
  the `sslip.io` name the site used before. They are reached directly, not
  through Cloudflare, so drop them once you turn on the firewall in step 5.
- `CLOUDFLARE_PROXY=1` tells Caddy to trust Cloudflare's addresses, and only
  those, to name the visitor. It also installs a weekly job that refreshes
  Cloudflare's address list.

If you use accounts, also set `BETTER_AUTH_URL=https://okjudge.com`, use the
new domain in the Google and Apple redirect URLs, and add it to the Turnstile
widget. Save, then run `sudo verdict-update --force`. Caddy requests the new
certificates through Cloudflare within a minute or two; until then
Cloudflare may show error 525 or 526. (`setup.sh --reconfigure` can set the address
and `CLOUDFLARE_PROXY` for you; it asks.)

**4. Check it.** From your computer (or the SSH window):

```bash
curl -sI https://okjudge.com | grep -iE '^(server|cf-ray)'   # server: cloudflare, and a cf-ray line
curl -sI https://www.okjudge.com | grep -i '^location'        # location: https://okjudge.com/
```

On the server:

```bash
sudo journalctl -u caddy -n 100 --no-pager | grep -iE 'certificate obtained|error'
curl -s localhost:2019/config/apps/http/servers/srv0/client_ip_headers   # ["CF-Connecting-IP"]
systemctl list-timers verdict-cloudflare-ips.timer                       # next weekly refresh
```

**5. Firewall, optional.** Attackers who know the server's IP address can
still skip Cloudflare and connect to it directly. They cannot fake their IP
that way (see below), but they do skip Cloudflare's protection. To block
them, let only Cloudflare reach ports 80 and 443. SSH stays open to
everyone on every port it uses (22, any port set in the SSH config or in
`ssh.socket`, and the port of your current session), so you can always log
in. Turn it on once everything above works:

1. In `/etc/verdict/verdict.env` set `FIREWALL_CLOUDFLARE_ONLY=1` and empty
   `LEGACY_HOSTS=`, then run `sudo verdict-update --force`. Check that
   `grep ^IPV6 /etc/default/ufw` prints `IPV6=yes` (the Ubuntu default);
   otherwise ufw cannot filter IPv6 and the script warns about it.
2. Turn the firewall on for a trial:

   ```bash
   sudo bash /opt/verdict/repo/deploy/aws-lightsail/cloudflare-ips.sh --enable-firewall
   ```

   This adds the rules and turns `ufw` on. It also schedules `ufw disable`
   in 10 minutes (add a number after the option for other minutes), and
   until you confirm, a restart brings the server back with `ufw` off. So a
   mistake cannot lock you out for good. The script refuses to turn `ufw` on
   if a `deny` rule for an SSH port could win over the allow rule, and warns
   about any remaining rule that may still open port 80 or 443 to everyone.
3. Keep that window open. Open a **new** SSH window and check that you can
   log in, and check in a browser that the site loads. If both work, keep
   the firewall (also across restarts):

   ```bash
   sudo bash /opt/verdict/repo/deploy/aws-lightsail/cloudflare-ips.sh --confirm-firewall
   ```

   If something is wrong, do nothing: the firewall turns itself off after
   10 minutes. You can also run `sudo ufw disable` at any time.
4. Check: `sudo ufw status` lists your SSH rule (`22/tcp`, or an existing
   `OpenSSH` or `LIMIT` rule) and one `80,443/tcp` rule per Cloudflare range.
   This command, run on your computer, connects to the server directly
   instead of through Cloudflare; it should now print `000` after 10 seconds
   instead of `200`:

   ```bash
   curl -sk -m 10 -o /dev/null -w '%{http_code}\n' --resolve okjudge.com:443:<server IP> https://okjudge.com/
   ```

The weekly job keeps the rules in step with Cloudflare's list (it leaves
them alone while a trial waits for confirmation). If you are ever locked out
after confirming, use your provider's console to run `sudo ufw disable`. To
turn the firewall off for good, run `sudo ufw disable` and set
`FIREWALL_CLOUDFLARE_ONLY=` (empty). The provider's own firewall
(Lightsail's **Networking** tab) can stay as it is.

**How visitor IPs reach the app.** Cloudflare puts the visitor's address in a
`CF-Connecting-IP` header. Caddy believes that header only when the
connection comes from one of Cloudflare's published addresses (kept in
`/etc/caddy/cloudflare-ips.caddy`). Any other connection counts as its own
address, whatever headers it sends. Caddy then replaces `X-Forwarded-For`
with that address, and the app rate-limits by it, so each visitor still has
their own limit and nobody can pick one.

**Renewals and upkeep.** Caddy renews certificates about 30 days before they
expire, through Cloudflare on port 80, so keep *Always Use HTTPS* off.
Cloudflare's address list is refreshed weekly and on every deploy. If a
download fails, the previous list stays in place; see
`systemctl status verdict-cloudflare-ips.service`, or refresh it by hand with
`sudo bash /opt/verdict/repo/deploy/aws-lightsail/cloudflare-ips.sh`. To stop
using the proxy, run `sudo ufw disable` first (if you turned the firewall on;
`verdict-update` refuses to switch the proxy setting off while it is on),
switch the records to *DNS only* (grey cloud), empty `CLOUDFLARE_PROXY=` and
`FIREWALL_CLOUDFLARE_ONLY=`, then run `sudo verdict-update --force`.

### Monthly cost

| Item | Cost |
|---|---|
| Lightsail $5 plan (static IP and 1 TB transfer included) | $5 |
| Model usage | about $30–50 per 1,000 verdicts (see *Cost per premium verdict*) |
| Automatic snapshots (optional) | a little per GB stored |

Every verdict is paid for with a credit or the monthly plan, and
`PREMIUM_DAILY_CAP` (500 by default, counted from the database) bounds a
day's runs. Treat the Anthropic spend limit (step 6) as the only hard stop.

## Deploy to Vercel (alternative)

Vercel runs the app without a server to look after, but needs more
accounts: free ones on GitHub, Vercel, Turso, Upstash and Cloudflare, plus
an Anthropic API key. Vercel's free **Hobby** plan is for personal,
non-commercial use only; a commercial site needs the Pro plan.

1. **Push the code to GitHub.** `.env` and the local SQLite files are
   git-ignored, but early commits tracked `dev.db-wal` and `dev.db-shm`,
   which hold stored verdict text. Untrack them first and commit that:
   `git rm --cached dev.db-wal dev.db-shm`. They also remain in the older
   commits, so if your local database ever held anything private, push a
   fresh repository (or rewrite history) rather than the old one. Then
   create an empty repository on github.com and from this folder run
   `git remote add origin <repo-url>` and `git push -u origin main`.
2. **Import it on Vercel.** On [vercel.com](https://vercel.com) choose
   *Add New → Project*, pick the repository, and keep the detected Next.js
   settings. Don't deploy yet — open *Environment Variables* first (or set
   them later under *Project → Settings → Environment Variables* and
   redeploy).
3. **Database (Turso).** Sign up at [turso.tech](https://turso.tech), create a
   database, and copy its URL (it starts with `libsql://`). Create a database
   token. In Vercel set `DATABASE_URL` to the URL and `DATABASE_AUTH_TOKEN` to
   the token. The table is created automatically on first use.
4. **Rate limits (Upstash Redis).** At [console.upstash.com](https://console.upstash.com)
   create a Redis database (any nearby region). In its *REST API* section copy
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` into Vercel. (The
   Upstash integration in the Vercel Marketplace can set both for you.)
   Without these, limits are per server instance and easy to bypass.
5. **Bot check (Cloudflare Turnstile).** In the Cloudflare dashboard open
   *Turnstile → Add widget*, add your Vercel domain (e.g. `verdict-you.vercel.app`)
   as a hostname, and choose *Managed*. Set the site key as
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the secret key as
   `TURNSTILE_SECRET_KEY`. `NEXT_PUBLIC_` values are baked in at build time,
   so redeploy after changing them. (For local testing, Cloudflare publishes
   test keys that always pass.)
6. **Model and budget.** Set `ANTHROPIC_API_KEY`, and `PREMIUM_DAILY_CAP` to
   the most verdicts per day you are willing to pay for (each costs about
   4 cents; see *Cost per premium verdict* above). Also set `RATE_LIMIT_SALT`
   to a long random string (e.g. the output of `openssl rand -hex 32`).
7. **Site details.** Set `CONTACT_EMAIL` to an inbox you read; the privacy
   page offers it for removal requests and hides the contact section until
   it is set. If you use a custom domain, set `NEXT_PUBLIC_SITE_URL` to it
   (e.g. `https://verdict.example.org`); on the default `*.vercel.app`
   domain it can stay unset. Both are read at build time, so redeploy after
   changing them.
8. **Set a hard spend limit.** In the [Anthropic Console](https://console.anthropic.com)
   set a monthly spend limit for your organization, so a bug or an attack can
   never cost more than you chose.
9. **Deploy.** Click *Deploy* (or *Redeploy*). Open the site, submit an
   argument, and check that the share link `/v/<id>` loads. A verdict can take
   up to a few minutes; the API route allows 300 seconds (`maxDuration`),
   which Hobby supports with Fluid compute (on by default for new projects).

## How it works

```
input ──▶ anonymize (names → Party A/B) ──▶ judge ×N (structured JSON)
                                                 │
   stored: anonymized text + result only         ▼
   share link /v/[id]  ◀── libSQL ◀── aggregate (majority vote → confidence)
```

- One well-crafted structured-output prompt does parse → steelman → classify
  claims (fact / value / definition / logic) → bedrock → crux → verdict
  (`lib/judge.ts`), forced through a JSON schema (structured outputs) so it always parses.
- The value framework (preset chips + fine-tuning sliders) is injected into the
  prompt and only matters when the crux is a values clash (`lib/frameworks.ts`).
- Aggregation and the confidence rules live in `lib/aggregate.ts`.
- If the model's own safety filter refuses, the app says so honestly instead of
  inventing a ruling.

## Testing

```bash
npm test        # unit tests: aggregation, rate limits, bot check, route gates, storage, accounts, entitlements
npm run eval    # LIVE eval of the judge against test/arguments.json (costs API calls)
npm run eval -- 5   # just the first 5 cases
```

`test/arguments.json` holds 30 hand-labeled arguments across all dispute types —
tune the judge prompt against it before trusting changes.

## Roadmap (v2)

- Two-party mode: each side states their case separately; a link invites the
  other party mid-argument
- Web-search fact-checking when a factual crux is load-bearing and confidence is low
- Staged pipeline (separate steelman / bedrock / verdict calls) where the single
  call visibly fails
