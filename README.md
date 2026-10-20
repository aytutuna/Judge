# ⚖️ Judge

> The product is called Judge. Internal names (repo, `/opt/verdict`, `verdict.service`, `verdict-update`, the `/api/verdict` route, database paths) keep "verdict".

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
check), and the 1–5 confidence meter comes from how often the runs agreed.
When that first round lands at low confidence (2 or below), two more judges
are called in and every vote is counted again, so a close call gets a bigger
panel instead of a coin flip; the verdict notes when this happened.
Fact/logic winner rulings are then cross-examined — an adversarial attack on
the crux, judged by a separate referee; a ruling that does not survive keeps
its verdict but its confidence is capped, and the attack is shown.

**Privacy = fairness**: before judging or storing anything, names are replaced
with *Party A* / *Party B*. The judge never knows who is who — which is also the
bias mitigation — and only the anonymized text is stored. The anonymizer is
itself a Claude call, so the raw text, names included, does go to Anthropic
once; the privacy page says so. The name map returns to your browser only,
where it puts the real names back into the verdict you see (a first-person
narrator reads as "You" / "Sen"); share pages and the stored row stay
anonymized. If anonymization fails for any reason (refusal, quota,
timeout, malformed output), the request fails closed: nothing is judged and
nothing is stored.

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
| `RATE_LIMIT_DB` | *(empty)* | Without Upstash: a libSQL file URL (e.g. `file:/run/verdict/ratelimit.db` in the Lightsail guide) where the in-memory limits log each counted verdict, so a restarted app process keeps its limits and daily count. Unset = they start over on every restart. If the file cannot be written, verdicts are refused (`503 unavailable`) |
| `RATE_LIMIT_SALT` | *(Upstash token)* | Secret key for hashing visitor IPs before they reach the rate-limit store. Any long random string. Unset = the Upstash token is used. Changing it resets every visitor's limits |
| `DAILY_VERDICT_CAP` | `1000` | Site-wide verdicts per UTC day. `0` pauses the site |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | *(empty)* | Cloudflare Turnstile site key. Unset = no bot-check widget |
| `TURNSTILE_SECRET_KEY` | *(empty)* | Turnstile secret for server-side verification. Unset = verification skipped (local dev) |
| `NEXT_PUBLIC_SITE_URL` | *(Vercel production domain, else `http://localhost:3000`)* | Public origin, e.g. `https://verdict.example.org`, used for canonical links, link previews, `robots.txt` and the sitemap. Set it for a custom domain or a host other than Vercel. Read at build time, so redeploy after changing it |
| `CONTACT_EMAIL` | *(empty)* | Address shown on `/privacy` for questions and removal requests. Unset or a placeholder (`example.com`) = the contact section is hidden. Read at build time, so redeploy after changing it |
| `CLAUDE_MODEL` | `claude-haiku-5-5` | Judge and crux-trial model |
| `CLAUDE_MODEL_LITE` | `claude-haiku-5-5` | Anonymizer model (always runs at `low` effort) |
| `JUDGE_EFFORT` | `medium` | Thinking depth for judge and trial calls: `low`, `medium` or `high` |
| `JUDGE_RUNS` | `3` | Self-consistency runs per verdict (1–3), run in parallel. Lower it to cut cost; confidence is capped accordingly |
| `JUDGE_EXTRA_RUNS` | `2` | Extra judges (0–4, in parallel) called in when the first round's confidence is at or below `JUDGE_ESCALATE_AT`; all votes are then aggregated together. `0` turns escalation off |
| `JUDGE_ESCALATE_AT` | `2` | Confidence (1–5) at or below which a verdict escalates. Only low-confidence verdicts escalate; with `JUDGE_RUNS=1` that is every verdict (one run caps confidence at 2), so set `JUDGE_EXTRA_RUNS=0` there if you want exactly one judge call |
| `CRUX_TRIAL` | `1` | Cross-examination of fact/logic winner rulings (up to 2 extra calls). Set `0` to skip it |

**Cost and latency:** one verdict costs 1 anonymizer call + `JUDGE_RUNS` judge
calls (in parallel), plus up to 2 sequential trial calls when a fact/logic
winner is declared, so winner verdicts take a little longer. Only a
low-confidence verdict adds `JUDGE_EXTRA_RUNS` more judge calls (one more
parallel round, about **$0.002** extra at the default 2). Measured on
Haiku 5.5 ($0.10 / $0.50 per 1M input / output tokens), a judge call uses
about 3,050 input and 1,300 output tokens, so a full verdict (3 judges +
anonymizer + up to 2 trial calls) costs roughly **$0.004–0.006** — about
**$4–6 per 1,000 verdicts**. With the default `DAILY_VERDICT_CAP=1000`, the
worst case is about $6 a day, plus about $2 if every verdict escalated.
Each call has a fixed time budget (60s for the anonymizer, 120s for judges,
45s for escalation judges, 60s total for the trial), so a verdict never hangs
indefinitely and the worst case (285s) fits the route's 300s limit. The SDK retries rate-limit and overload errors
automatically, and a verdict that still fails on a 429 is reported as a quota
error.

## Abuse protection

Every `POST /api/verdict` passes these gates, in order, before any model call:

1. **Bot check** — the Cloudflare Turnstile token from the page is verified
   server-side (`lib/turnstile.ts`). Missing or invalid → `403 captcha_failed`.
2. **Rate limits** (`lib/ratelimit.ts`) — per visitor IP: 5 verdicts per
   10 minutes and 20 per 24 hours (`429 rate_limited`); site-wide:
   `DAILY_VERDICT_CAP` per UTC day (`503 daily_cap`). Both include
   `retryAfterSec`. An IPv6 visitor is counted per /64 prefix, since one
   client usually holds a whole /64. The store only sees a keyed hash
   (HMAC-SHA256 with `RATE_LIMIT_SALT`) of the IPv4 address or IPv6 prefix,
   kept for up to 24 hours. The store is Upstash Redis when configured, else
   the app's memory, optionally logged to `RATE_LIMIT_DB` so restarts keep
   it. If Redis or that log is down or slow, requests are refused
   (`503 unavailable`) rather than let through unmetered.

Then: API key check → anonymize → judges (→ extra judges if confidence is
low) → crux trial → save.

The visitor IP comes from the first `X-Forwarded-For` entry, so it is only
trustworthy behind a proxy that overwrites that header: Vercel does, and so
does the Caddy setup in the Lightsail guide below, also behind Cloudflare's
proxy (see *Custom domain behind Cloudflare*).

## Accounts and Premium

Accounts are optional. Signed-out and free visitors get exactly the free
experience above. Signing in (Apple, Google or an emailed link) unlocks
**Premium**: clarifying questions, web fact-checking with sources and a
stronger judge panel. It is paid for with credits (one premium verdict = one
credit) or a monthly plan with a fair-use cap. There is no payment provider
yet: prices live in `lib/pricing.ts`, the buy buttons read "Coming soon", and
testers get premium from the admin script below.

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
| `RESEND_API_KEY`, `EMAIL_FROM` | *(empty)* | [Resend](https://resend.com) API key and sender, e.g. `Judge <signin@okjudge.com>` on a domain verified in Resend. Both set = email sign-in links work. With `TURNSTILE_SECRET_KEY` set, the email form needs a Turnstile token too |
| `DEV_LOGIN` | *(empty)* | `1` shows a "test sign-in" for local testing. It works only when **all** hold: not a production build (`next build` output is production whatever `NODE_ENV` it is started with), `DEV_LOGIN=1`, the server listens on `127.0.0.1` or `::1` only (`npm run dev:login`, i.e. `next dev -H 127.0.0.1`; plain `npm run dev` listens on every interface and is refused), and the request's `Host` is `localhost`, `127.0.0.1` or `[::1]`. Anywhere else the endpoint answers 404 |
| `PREMIUM_ENABLED` | `1` | `0` turns Premium off (the switch disappears; premium requests get `503 not_configured`) |
| `PREMIUM_DAILY_CAP` | `500` | Site-wide premium runs per UTC day, counted from the database, refunded ones included (a refused or failed run still costs its model calls). A cost circuit breaker; `0` pauses Premium. Clarifying questions are not counted; the per-account limit below bounds them |
| `PREMIUM_JUDGE_MODELS` | `claude-sonnet-5-5,claude-sonnet-5-5,claude-haiku-5-5` | Premium panel seats, in order (1 to 5) |
| `PREMIUM_SONNET_EFFORT` | `medium` | Thinking depth for non-Haiku premium judges: `low`, `medium` or `high` |
| `PREMIUM_FACTCHECK_MODEL` | `claude-haiku-5-5` | Model for the web fact-check |
| `PREMIUM_FACTCHECK_MAX_SEARCHES` | `3` | Web searches per fact-check (1 to 5), $0.01 each |

Sign-in providers without credentials are reported as unavailable by
`GET /api/v1/config`, and the sign-in page shows them disabled.

**Limits for Premium:** per account 10 premium verdicts per 10 minutes and
60 per 24 hours, 20 clarifying-question requests per 10 minutes and 100 per
24 hours (`429 rate_limited`), plus `PREMIUM_DAILY_CAP` (`503 daily_cap`). Premium
skips Turnstile: the signed-in account and these limits are the gate. A
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
   fact-check. Escalation and the crux trial work as on the free tier.
4. The verdict is stored like a free one (anonymized), with `tier`,
   `fact_check` and `panel` added, and the reserved credit is consumed
   (or returned, see above).

**Cost per premium verdict** (Haiku $0.10/$0.50 and Sonnet $2/$10 per
million tokens, $0.01 per search). Measured on 6 logged local runs:
**$0.031 to $0.052**, about $0.05 for a factual dispute with 2 searches and
about $0.03 for a values dispute with no search; the two Sonnet seats are
most of it. That is the typical range, not a limit: every model call may
write up to 16k output tokens, so the code allows up to about **$0.43** for
one verdict (anonymize $0.008, fact-check with 3 searches $0.044, two Sonnet
seats $0.34, Haiku seat $0.008, escalation $0.017, crux trial $0.017). Each
clarifying-question call can add up to about $0.008. A free verdict costs
about $0.005.

**Margins** have to be worked out on what is left after the app store's cut
(Apple and Google keep 15 to 30%), since the mobile app is the main target.
At a 30% cut one credit nets about $0.139 (10 for $1.99) or $0.116 (30 for
$4.99): enough at the typical cost, though a verdict at the code ceiling
costs about 3 credits. The monthly plan nets about $3.49 to $4.24 of its
$4.99: at the current cap of 60 a heavy user costs about $2.40 at the
measured average ($0.039) and about $3.12 at $0.052 a verdict, which still
leaves a margin after a 15% store cut but little after 30%. To widen it,
lower the cap (`PRICING.monthly.fairUseCap` in `lib/pricing.ts`), raise the
price, or lower the per-verdict ceiling (for
example a smaller `max_tokens` for the Sonnet judge calls, whose measured
output is 500 to 800 tokens; not done yet).

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
  `lib/account-types.ts`, `lib/pricing.ts`.

| Call | Purpose |
|---|---|
| `GET /api/v1/config` | Startup: which sign-in methods work, whether Premium is on, prices (`AppConfig`) |
| `GET /api/v1/me` | The account and its entitlement (`MeResponse`); signed out = `{ "user": null, "entitlement": null }` |
| `DELETE /api/v1/me` `{ "confirm": "delete" }` | Deletes the account, sessions, sign-ins and entitlements (both stores require in-app deletion) |
| `POST /api/v1/clarify` | Premium: up to 2 clarifying questions |
| `POST /api/v1/verdict` | A verdict; `"tier": "premium"` for Premium. Send an `Idempotency-Key` header to retry safely |
| `GET /api/v1/verdicts/{id}` | A stored verdict |
| `POST /api/v1/verdicts/{id}/translate?lang=en\|tr` | A stored verdict in the other language |
| `POST /api/v1/auth/dev-login` | Local testing only (see above); 404 everywhere else |

**Sign-in from the app** (Better Auth endpoints under `/api/auth`):

- **Apple (iOS):** `expo-apple-authentication` with a random nonce (Apple gets
  its SHA-256), then `POST /api/auth/sign-in/social`
  `{ "provider": "apple", "idToken": { "token": "<identityToken>", "nonce": "<raw nonce>", "user": { "name": { "firstName": "…", "lastName": "…" } } } }`.
  Apple sends the name only on the first sign-in, so pass it then. Needs
  `APPLE_APP_BUNDLE_ID`.
- **Google (iOS/Android):** native Google Sign-In, then
  `POST /api/auth/sign-in/social { "provider": "google", "idToken": { "token": "<idToken>" } }`.
  Needs the iOS/Android client ids above.
- Both answer `200 { "redirect": false, "token": "<session token>", "user": { … } }`
  (also in the `set-auth-token` header); keep the token in the device's secure
  storage. An invalid ID token answers `401 { "code": "INVALID_TOKEN" }`.
- **Session:** `GET /api/v1/me`. **Sign out:** `POST /api/auth/sign-out` with
  the bearer token. Sessions last 30 days and slide forward with use.
- **Email links in the app** need Better Auth's Expo plugin and a deep link
  (`verdict://`), plus a bot check other than Turnstile; not wired up yet.
- **Free verdicts from the app** need a bot check other than Turnstile
  (e.g. App Attest / Play Integrity, or free verdicts for signed-in users
  under a per-user limit) before the app ships.

**Purchases (future):** all purchase sources feed one account. Each grant
records its source (`app_store`, `play_store`, `web`, `admin`, `promo`) and
applies at most once per external transaction/event id. A webhook (for
example RevenueCat, `POST /api/v1/webhooks/revenuecat` checked against a
shared secret) maps each store event to one normalized `StoreEvent` and calls
`applyStoreEvent()` in `lib/entitlements.ts`:

| StoreEvent | When |
|---|---|
| `{ type: "credits_purchased", eventId, source, userId, productId, credits, transactionId }` | A credit pack was bought (credits from `STORE_PRODUCTS` in `lib/pricing.ts`); granted once per `transactionId` |
| `{ type: "subscription_active", eventId, source, userId, productId, originalTransactionId, periodStart, periodEnd, willRenew }` | Purchase, renewal, un-cancel or plan change; a new period resets the fair-use count |
| `{ type: "subscription_will_not_renew", eventId, source, originalTransactionId }` | Auto-renew turned off; access stays until the period ends |
| `{ type: "subscription_expired", eventId, source, originalTransactionId, at }` | The subscription ended (ignored if a later renewal already arrived) |
| `{ type: "refund", eventId, source, transactionId }` | A refund: credits are taken back (never below 0), a refunded subscription ends at once |

The app identifies the buyer to the store SDK with our `user.id` (e.g.
RevenueCat `Purchases.logIn(user.id)`), then refreshes `GET /api/v1/me`.
Apple's rule for multiplatform services: credits or plans bought on the web
may be used in the iOS app only if the same items are also sold as in-app
purchases there.

## Deploy to AWS Lightsail

One small Linux server runs everything: the app, its SQLite database file,
and [Caddy](https://caddyserver.com) for HTTPS. Besides AWS you only need
your Anthropic API key, and the code on GitHub at
`github.com/aytutuna/Verdict` (public). No Turso, Upstash or Cloudflare
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
   curl -fsSL https://raw.githubusercontent.com/aytutuna/Verdict/main/deploy/aws-lightsail/setup.sh -o setup.sh && sudo bash setup.sh
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
  automatically.
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
  after that backup are lost; the replaced database is kept beside it). These
  copies live on the same disk, so also turn on off-server backups: on your
  instance's **Snapshots** tab, switch on **Automatic snapshots** (Lightsail
  keeps the last seven daily snapshots; they are billed per GB stored).
- **Reboots:** if the terminal says *System restart required* after security
  updates, run `sudo reboot`; the app and Caddy start again on their own.
  A reboot also starts every rate limit and the daily cap over.

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
| Model usage | about $4–6 per 1,000 verdicts (see *Cost and latency*) |
| Automatic snapshots (optional) | a little per GB stored |

`DAILY_VERDICT_CAP` (1000 by default) holds model spend to about $6 per UTC
day in normal running: the count survives app restarts, crashes and deploys
(it is logged to `/run/verdict`). It is not a hard cap: a reboot of the
server starts the count over, so a day with reboots can go past it. Lower
the cap to what you are willing to pay, and treat the Anthropic spend limit
(step 6) as the only hard stop.

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
6. **Model and budget.** Set `ANTHROPIC_API_KEY`, and `DAILY_VERDICT_CAP` to
   the most verdicts per day you are willing to pay for (each costs about
   half a cent; see *Cost and latency* above). Also set `RATE_LIMIT_SALT`
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
