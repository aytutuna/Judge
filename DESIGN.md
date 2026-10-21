# Verdict: accounts, Premium and the API for mobile

This file records how accounts, entitlements and Premium judging are built,
and the contract the future iOS/Android app will use. Setup, env vars and
the admin script are in the README ("Accounts and Premium").

## Decisions

| Topic | Decision |
|---|---|
| Product | The website and a later native app (iOS + Android, likely Expo / React Native) share one backend. The app will be the main product, so every capability is a versioned JSON HTTP API. No server actions, no cookie-only flows. |
| Tiers | **Free**: the original pipeline, limits and UI flow, unchanged, for signed-out and free users. **Premium**: clarifying questions, web fact-check with sources, stronger judge panel. |
| Auth | [Better Auth](https://www.better-auth.com) 1.7 on the existing libSQL database (`@libsql/kysely-libsql`; an npm `overrides` entry keeps one `@libsql/client`). Browser: HttpOnly cookie `verdict.session_token` (`__Secure-` on https). App: the same session token as `Authorization: Bearer`. 30-day sliding sessions. |
| Sign-in | Apple and Google (web redirect and native ID token), email magic link (website) or 6-digit email code (apps), both through Resend, and a dev-only test login. Methods without credentials are reported unavailable by `GET /api/v1/config` and shown disabled. |
| Dev login | Only when the code is not a production build (the `process.env.NODE_ENV` literal is inlined by `next build`, so starting a build with another `NODE_ENV` does not help) **and** `DEV_LOGIN=1` **and** the server listens on loopback only (`next dev -H 127.0.0.1`, read from Next's recorded listen origin) **and** the `Host` header is `localhost`/`127.0.0.1`/`[::1]` (`X-Forwarded-Host` ignored). Otherwise 404. |
| Errors | `{ error, code, retryAfterSec?, resetsAt? }` with stable codes in `lib/api-errors.ts`. |
| Entitlements | Credit balance + subscriptions + an append-only grant ledger with `UNIQUE(source, external_id)` + a `premium_usage` reservation table. A credit is reserved before any model call, then consumed or refunded. Writes are single conditional `batch()` statements under an in-process mutex with SQLITE_BUSY retry; interactive transactions are never used (they failed 7 of 8 under parallel load on one libSQL client). |
| Fact-check | One Claude call: `claude-haiku-5-5` + `web_search_20250305` (`max_uses` 3) + JSON-schema output. Only source URLs that appeared in the search results survive. `web_search_20260209` was dropped: on Haiku it sometimes rejected every search and fell back to code execution, which returns no verifiable URLs. Sonnet skipped the search at low effort, so the fact-check stays on Haiku. |
| Panel | `claude-sonnet-5-5` (A first), `claude-sonnet-5-5` (B first), `claude-haiku-5-5` (A first), configurable with `PREMIUM_JUDGE_MODELS`. A blocked Sonnet seat is retried once on Haiku. Escalation and crux trial stay on Haiku. Sonnet requests set `effort` explicitly and never send `temperature` or `thinking: disabled` (both are 400s). |
| Clarify | `POST /api/v1/clarify`, Haiku, low effort, at most 2 questions, never spends a credit, fails open to no questions. Per account 20 per 10 min and 100 per 24 h. The raw text goes to Anthropic (not stored); answers are appended before anonymization. |
| Shared code | Plain TypeScript modules with no Next, DOM or Node imports, enforced by `test/pure-modules.test.ts`: `lib/types.ts`, `lib/i18n.ts`, `lib/verdict-display.ts`, `lib/names.ts`, `lib/palette.ts`, `lib/frameworks.ts`, `lib/content-lang.ts`, `lib/api-errors.ts`, `lib/account-types.ts`, `lib/pricing.ts`. |

## Architecture

```
Browser (cookie)            Native app (Bearer)
      │                            │
      ├── /api/auth/*  (Better Auth: social redirect + callback, ID-token sign-in,
      │                 magic link, get-session, sign-out)
      ├── /api/v1/config           GET   sign-in methods, premium on/off, pricing
      ├── /api/v1/me               GET   viewer + entitlement      DELETE  delete account
      ├── /api/v1/auth/dev-login   POST  dev only
      ├── /api/v1/auth/apple/code  POST  app: Apple authorization code (kept for revocation)
      ├── /api/v1/clarify          POST  premium: up to 2 questions
      ├── /api/v1/verdict          POST  free | premium   (same handler as /api/verdict)
      ├── /api/v1/verdicts/{id}    GET   stored verdict (no input text)
      ├── /api/v1/verdicts/{id}/translate POST  (same handler as /api/verdict/{id}/translate)
      └── /api/v1/webhooks/revenuecat     POST  RevenueCat only (shared secret)
```

The free request path in `app/api/verdict/route.ts` is untouched: one early
branch hands `tier: "premium"` to `lib/premium/handler.ts`, which is loaded
only then. Free requests never touch auth or entitlements, and free results
carry no `tier`, `fact_check` or `panel` keys.

Premium verdict order: Idempotency-Key format → session (401) → same-origin
for cookie sessions (403) → premium configured (503) → per-user limits
(429: 10 per 10 min, 60 per 24 h) → site-wide `PREMIUM_DAILY_CAP` (503) →
reserve a credit (402 `premium_required | no_credits | fair_use`, 409
`in_progress`, or a replay) → anonymize argument + clarifications →
fact-check (≤ 40 s, fails open) → panel → escalation (if elapsed < 150 s) →
crux trial (if elapsed < 225 s) → save → consume. Any failure after the
reservation refunds it, and so does a model refusal or a degraded panel (no
non-Haiku seat succeeded, so the verdict is not the stronger panel that was
paid for; it is still shown). Turnstile is not used
for Premium: the account and the per-user limits are the gate.

Funding order: an active subscription under its fair-use cap first, then
credits. Reservations still open after 10 minutes are refunded lazily.

## Two-sided cases, evidence and appeals

Code: `lib/cases/**` (tables, state machine, credits, judging, HTTP),
`lib/evidence/**` (images, transcripts, tokens, submission anonymizer),
shapes in `lib/case-types.ts`. The free flow and a premium request without
evidence send exactly the requests they did before.

| Topic | Decision |
|---|---|
| Real names | Never on the server. Each submission (side A, side B, each appeal) is anonymized once, when it is submitted, together with its evidence transcripts, and its name map goes back only in that response. The server keeps keyed, case-salted name fingerprints (`case_people`: HMAC of case id + normalized name -> label) so the second account and appeals reuse the same labels. |
| Visibility | Before a two-sided verdict nobody sees the other side. The respondent view carries no sides at all until then (the link is the credential and the owner holds it too). After a two-sided verdict both parties see both anonymized accounts, transcripts, appeals and every verdict. A case judged on the owner's side alone shows the respondent no verdict. Share pages show only the verdict. |
| Invite links | 128-bit token = HMAC(derived key, case id + nonce), base64url. The table stores the nonce and sha256(token); the owner's link is re-derived, and a new nonce turns the old one off. The token never goes into a sign-in redirect: the respondent's sign-in returns to `/r`, which reads the token back from the browser. |
| Who is Party B | Fixed when side B is submitted: a signed-in answer sets `respondent_user_id` in the same guarded UPDATE; a signed-out answer stores `respondent_claim_nonce` and returns a claim secret = HMAC(derived key, case id + nonce) (re-derived for a replayed key; never stored). A Party B appeal needs the bound account, or the claim (the first accepted appeal then binds the account). Holding the link alone is not enough. |
| States | `awaiting_respondent -> judging -> judged`, plus `failed` (retryable, refunded) and `expired` (7 days, refunded; reads report it before the sweep writes it). Transitions are one conditional UPDATE, so a respondent and a judge-now race has exactly one winner. |
| Credits | The owner's unit is reserved in `premium_usage` at creation with `hold_until = expires_at`; the stale sweep refunds 10 minutes after `COALESCE(hold_until, created_at)`. Judging consumes it in the same batch that links the verdict; failure, refusal, a degraded panel, expiry and deletion refund it. Appeals reserve the appealer's unit. |
| Judging | After the response (`after()`), clients poll `GET` every `pollAfterMs`. Every write of a run is guarded by a fresh token (`judging_token` / `attempt_token`), so a run the 10-minute sweep already failed, or a deleted case, changes nothing. |
| Judges | Same premium pipeline (fact-check on the document, 2 x Sonnet + Haiku, escalation, crux trial). Two-sided runs add `TWO_SIDED_JUDGE_NOTE` and `TWO_SIDED_JUDGE_SCHEMA` (`agreed_facts`, `disputed_facts`, `would_change` before the forced ruling, which stays last); evidence adds `EVIDENCE_JUDGE_NOTE`; appeals add `APPEAL_JUDGE_NOTE` (`APPEAL_ONE_SIDED_JUDGE_NOTE` on a case judged on one side, where nobody answered either text) and re-judge the whole record without showing the earlier verdict. When the crux trial overturns a two-sided ruling, the decisive dispute is stored as `unsettled`. Deadline gates count from the request that scheduled the run, so anonymizing in that request counts; a refused seat's Haiku rerun is skipped past 220 s. Each case's model calls are logged with its id (`[premium] ... case=<id>` for judging, `[cases] usage case=<id> step=...` for each anonymize call and the appeal summary). |
| Appeals | One per party per case (at most two), owner or the signed-in Premium respondent who wrote side B (see above). The verdict it answers is read inside the INSERT (latest seq), not from the pre-anonymize snapshot. Labelled `upheld / overturned / changed` (shown as "Verdict stands / flipped / changed") against that verdict, with the confidence change and a one-sentence summary (Haiku, fails open to empty). A refused re-judge fails the appeal and refunds instead of storing a refused card. |
| Evidence | Images are checked by magic bytes, transcribed in memory, and thrown away; the client gets a signed token (6 h) holding the raw transcript, and the submission anonymizes it with the text. Only anonymized transcripts are stored. |
| Deletion | `DELETE /cases/{id}` and account deletion remove sides, evidence, fingerprints, appeals, case verdicts and their translations; bindings to the deleted account elsewhere are cleared. |
| Kill switches | `CASES_ENABLED=0`, `EVIDENCE_ENABLED=0` (also off whenever Premium is off); `GET /api/v1/config` reports `features`. |

## API for mobile

### Principles
- Base URL `https://<domain>/api/v1`; JSON only; additive changes only within v1.
- Auth: `Authorization: Bearer <session token>`. Native apps need no cookies or CORS. Bearer requests are exempt from the same-origin check that protects cookie-authenticated writes.
- Errors: `{ error, code, retryAfterSec?, resetsAt? }`. The app localizes `code` with the shared `error.<code>` keys in `lib/i18n.ts`.
- `POST /verdict` accepts an `Idempotency-Key` header (1 to 64 of `[A-Za-z0-9_-]`): a retry with the same key never spends a second credit; a finished one replays with `replayed: true`.

### Sign-in flows
- **Apple (iOS):** `expo-apple-authentication` with a random nonce (Apple gets `SHA256(nonce)`), then `POST /api/auth/sign-in/social { provider: "apple", idToken: { token: identityToken, nonce, user: { name: { firstName, lastName } } } }`. Response `{ redirect: false, token, user }` (and the `set-auth-token` header); keep `token` in SecureStore. Apple sends the name only on the first sign-in. Audience: `APPLE_APP_BUNDLE_ID`. Then, at once, `POST /api/v1/auth/apple/code { code: authorizationCode }` with the bearer token → `{ stored: true }`: the server exchanges the code with Apple (client id `APPLE_APP_BUNDLE_ID`, no redirect URI) and keeps the refresh token sealed with `ORIGINALS_KEY`, only to revoke it on account deletion. A failure does not affect the session.
- **Google (iOS/Android):** native Google Sign-In, then `POST /api/auth/sign-in/social { provider: "google", idToken: { token } }`. Accepted audiences: the web, iOS and Android client ids.
- Invalid ID tokens answer `401 { code: "INVALID_TOKEN" }`.
- **Email (apps):** when `signIn.emailCode` is true, `POST /api/auth/email-otp/send-verification-otp?lang=tr { email, type: "sign-in" }` → `{ success: true }` and a 6-digit code by email; then `POST /api/auth/sign-in/email-otp { email, otp }` → `{ token, user }` (and `set-auth-token`). Codes last 10 minutes, 3 wrong tries burn a code (`INVALID_OTP`, `TOO_MANY_ATTEMPTS`, `OTP_EXPIRED`), 3 requests per minute per IP; no Turnstile.
- **Session:** `GET /api/v1/me`. A bearer token with no live session gets `401 signin_required` on every session-aware route (free verdicts and public reads included); requests without `Authorization` are unaffected. **Sign out:** `POST /api/auth/sign-out`. **Delete account** (required by both stores): `DELETE /api/v1/me { "confirm": "delete" }`. It first revokes every stored Sign in with Apple refresh token at `https://appleid.apple.com/auth/revoke` with the client id it was issued to (Services ID for website sign-ins, kept from Better Auth's callback exchange; bundle id for the app's codes). Apple failures are logged without the token, recorded in the account's removal-log entry (`signInTokens: { apple: "revoked" | "partial" | "failed" | "none" }`) and never block the deletion. Google sign-in keeps no token, so there is nothing to revoke.

### Core calls
| Call | Response |
|---|---|
| `GET /config` | `AppConfig` (`lib/account-types.ts`) |
| `GET /me` | `MeResponse`; signed out = `{ user: null, entitlement: null }` (200) |
| `DELETE /me` | `{ deleted: true }` |
| `POST /clarify { argument, lang }` | `{ questions: [{ id, text }] }` (0 to 2) |
| `POST /verdict { argument, framework?, lang, tier?, clarifications? }` | `VerdictApiResponse` (`lib/types.ts`); premium adds `entitlement` |
| `GET /verdicts/{id}` | `{ id, result, createdAt }` |
| `POST /verdicts/{id}/translate?lang=en\|tr` | the stored verdict translated |

Free verdicts from the app need a bot check before launch, because Turnstile
is web-only: App Attest / Play Integrity, or free verdicts for signed-in
bearer users under a per-user limit. Decide before the app ships.

### Purchases and entitlement webhooks
Every grant stores its source (`admin | app_store | play_store | web | promo`)
and is applied at most once per `(source, external id)`. The single entry
point is `applyStoreEvent(e: StoreEvent)` in `lib/entitlements.ts`:

```ts
type StoreEvent =
  | { type: "credits_purchased"; eventId; source; userId; productId; credits; transactionId }
  | { type: "subscription_active"; eventId; source; userId; productId; originalTransactionId;
      periodStart; periodEnd; willRenew }               // purchase, renewal, un-cancel, plan change
  | { type: "subscription_will_not_renew"; eventId; source; originalTransactionId }
  | { type: "subscription_expired"; eventId; source; originalTransactionId; at }  // ignored after a later renewal
  | { type: "refund"; eventId; source; transactionId };  // credits taken back (never below 0); subscription ends
```

RevenueCat handles App Store, Play Store and web billing, so there is one
webhook. The app calls `Purchases.logIn(<our user.id>)` before buying.
RevenueCat calls `POST /api/v1/webhooks/revenuecat` with
`Authorization: Bearer ${REVENUECAT_WEBHOOK_SECRET}` (constant-time compare;
503 when unset; then 600 requests per 10 min per IP, counted only after the
secret matches so forged requests cannot exhaust RevenueCat's allowance;
256 KB body cap). The route
(`app/api/v1/webhooks/revenuecat/route.ts`) maps the event with
`mapRevenueCatEvent()` (`lib/revenuecat.ts`, no database access), resolves the
buyer for grants and calls `applyStoreEvent()`; the app then refreshes
`GET /me`. Field names follow RevenueCat's "Event Types and Fields" reference.

| RevenueCat `type` | StoreEvent |
|---|---|
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE` (subscription; `new_product_id` when given) | `subscription_active` (`purchased_at_ms` → `expiration_at_ms`, `willRenew: true`, keyed by `original_transaction_id`) |
| `NON_RENEWING_PURCHASE` or `INITIAL_PURCHASE` (pack) | `credits_purchased` (credits from `STORE_PRODUCTS` × `quantity`, keyed by `transaction_id`) |
| `CANCELLATION` (subscription, not a refund) | `subscription_will_not_renew` |
| `CANCELLATION` with `cancel_reason: "CUSTOMER_SUPPORT"` | `refund` (`transaction_id` for a pack, `original_transaction_id` for the plan) |
| `EXPIRATION` (subscription) | `subscription_expired` at `expiration_at_ms` |
| `TEST` | `200 { ok, test }` |
| `BILLING_ISSUE`, `SUBSCRIPTION_PAUSED` (access continues; `EXPIRATION` ends it), `TRANSFER` (the ledger has no move between accounts), a pack `CANCELLATION` with another reason, other types | `200 { ignored, reason }` |

`store`: `APP_STORE`/`MAC_APP_STORE` → `app_store`, `PLAY_STORE` →
`play_store`, `STRIPE`/`RC_BILLING`/`PADDLE` → `web`, others ignored. Google
Play product ids `<subscription>:<base plan>` are read by the part before the
colon. `eventId = event.id` (RevenueCat retries reuse it). Sandbox events are
ignored unless `ALLOW_SANDBOX_PURCHASES=1`. Grants go to the first existing
account among `app_user_id`, `original_app_user_id` and `aliases` (anonymous
`$RCAnonymousID:` ids skipped); none = `200 { ignored: "unknown_user" }`, so
RevenueCat does not retry forever. Events keyed by a transaction alone
(will-not-renew, expiry, refund) need no account: one nobody has is
`200 { applied: false }`. A database failure answers 503 so RevenueCat
retries. A direct web provider maps its own webhook to the same union.
Apple's multiplatform rule: items bought on the web may be used in the iOS
app only if they are also sold as in-app purchases there.

Known limits of the ledger rules (unchanged by the webhook): a purchase whose
delivery failed and is retried after its refund was already applied is
granted again (a subscription row that is not active is reactivated; a refund
of credits not yet granted finds nothing). It needs a refund inside the
roughly 80-minute retry window. `PRODUCT_CHANGE` applies the new product at
once with the current period, which is harmless while there is one plan and
must be revisited before a second (e.g. yearly) plan. `TRANSFER` is ignored:
after a restore moves a purchase to another account, the next `RENEWAL`
reassigns the subscription; RevenueCat's restore behavior can be set to keep
purchases with the original App User ID.

## Domain and go-live

`sslip.io` is not on the Public Suffix List, so it counts as someone else's
domain. Before going live with web sign-in:

- **Email (Resend):** sending needs SPF/DKIM records on your own domain.
- **Google:** the consent screen's authorized domains and privacy URLs must be on a domain you can verify.
- **Apple (web):** the Services ID needs your domain and the return URL `https://<domain>/api/auth/callback/apple`; no IPs or localhost.
- Native iOS/Android sign-in does not depend on the domain.

Checklist: buy a domain → DNS to the server → `NEXT_PUBLIC_SITE_URL` and
`BETTER_AUTH_URL` → `BETTER_AUTH_SECRET` → Google OAuth client
(`https://<domain>/api/auth/callback/google`) → Apple Services ID, key and
`APPLE_*` → Resend domain, `RESEND_API_KEY`, `EMAIL_FROM` → redeploy →
`scripts/grant.ts` for testers.

## Cost

Measured on 6 logged local runs: $0.031 to $0.052 per premium verdict (about
$0.05 factual with 2 searches, $0.03 values with no search); free verdicts
about $0.005. The code ceiling is higher: every call may write 16k output
tokens, so one premium verdict can cost up to about $0.43 (two Sonnet seats
$0.34 of it). Margins must be computed after the app store's 15 to 30% cut:
at 30% a credit nets $0.116 to $0.139, fine at the typical cost; the monthly
plan nets $3.49 to $4.24 and loses money at a cap of 200 ($6.20 to $10.40)
and breaks about even at 60, so the cap, the price or the per-verdict ceiling
(smaller Sonnet `max_tokens`) needs a decision before it is sold.
`PREMIUM_DAILY_CAP` (default 500) caps premium runs per UTC day, refunded
ones included: typically $15 to $26 a day at the default, at most about
$215. Clarifying questions are outside it and bounded per account (100 a
day).

## Open questions

1. Monthly plan economics (cap or price).
2. Bot protection for free verdicts from the app.
3. Better Auth's own multi-step writes may hit SQLITE_BUSY under heavy parallel sign-ups; low risk at current traffic.
4. Mixed-model panels may change how often runs agree, so confidence calibration should be checked in the free vs premium eval.
