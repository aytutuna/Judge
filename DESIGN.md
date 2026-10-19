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
| Sign-in | Apple and Google (web redirect and native ID token), email magic link (Resend), and a dev-only test login. Methods without credentials are reported unavailable by `GET /api/v1/config` and shown disabled. |
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
      ├── /api/v1/clarify          POST  premium: up to 2 questions
      ├── /api/v1/verdict          POST  free | premium   (same handler as /api/verdict)
      ├── /api/v1/verdicts/{id}    GET   stored verdict (no input text)
      └── /api/v1/verdicts/{id}/translate POST  (same handler as /api/verdict/{id}/translate)
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

## API for mobile

### Principles
- Base URL `https://<domain>/api/v1`; JSON only; additive changes only within v1.
- Auth: `Authorization: Bearer <session token>`. Native apps need no cookies or CORS. Bearer requests are exempt from the same-origin check that protects cookie-authenticated writes.
- Errors: `{ error, code, retryAfterSec?, resetsAt? }`. The app localizes `code` with the shared `error.<code>` keys in `lib/i18n.ts`.
- `POST /verdict` accepts an `Idempotency-Key` header (1 to 64 of `[A-Za-z0-9_-]`): a retry with the same key never spends a second credit; a finished one replays with `replayed: true`.

### Sign-in flows
- **Apple (iOS):** `expo-apple-authentication` with a random nonce (Apple gets `SHA256(nonce)`), then `POST /api/auth/sign-in/social { provider: "apple", idToken: { token: identityToken, nonce, user: { name: { firstName, lastName } } } }`. Response `{ redirect: false, token, user }` (and the `set-auth-token` header); keep `token` in SecureStore. Apple sends the name only on the first sign-in. Audience: `APPLE_APP_BUNDLE_ID`.
- **Google (iOS/Android):** native Google Sign-In, then `POST /api/auth/sign-in/social { provider: "google", idToken: { token } }`. Accepted audiences: the web, iOS and Android client ids.
- Invalid ID tokens answer `401 { code: "INVALID_TOKEN" }`.
- **Email (later):** magic link with `callbackURL: "verdict://auth"`, which needs the `@better-auth/expo` server plugin, app links, and a bot check other than Turnstile.
- **Session:** `GET /api/v1/me`. **Sign out:** `POST /api/auth/sign-out`. **Delete account** (required by both stores): `DELETE /api/v1/me { "confirm": "delete" }`.

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

### Purchases and entitlement webhooks (future)
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

Recommended: RevenueCat for App Store, Play Store and web billing, so there
is one webhook. The app calls `Purchases.logIn(<our user.id>)` before buying.
RevenueCat calls `POST /api/v1/webhooks/revenuecat` with
`Authorization: Bearer ${REVENUECAT_WEBHOOK_SECRET}`; the handler maps the
event and calls `applyStoreEvent()`; the app then refreshes `GET /me`.
Mapping (verify field names against RevenueCat's docs when implementing):

| RevenueCat `type` | StoreEvent |
|---|---|
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE` (subscription) | `subscription_active` |
| `NON_RENEWING_PURCHASE` (pack) | `credits_purchased` (credits from `STORE_PRODUCTS` in `lib/pricing.ts`) |
| `CANCELLATION` (not a refund) | `subscription_will_not_renew` |
| `CANCELLATION` with `cancel_reason: "CUSTOMER_SUPPORT"` | `refund` |
| `EXPIRATION` | `subscription_expired` |
| `TEST` | ignored |

`store`: `APP_STORE` → `app_store`, `PLAY_STORE` → `play_store`,
`STRIPE`/`RC_BILLING` → `web`; `eventId = event.id`; sandbox events only
with an explicit opt-in. A direct web provider maps its own webhook to the
same union. Apple's multiplatform rule: items bought on the web may be used
in the iOS app only if they are also sold as in-app purchases there.

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
