# Judge on Cloudflare Workers

The website and API run as one Worker built by OpenNext (`npm run cf:build`).
`wrangler.jsonc` has the production names at the top and a `staging`
environment under `env`. Nothing here replaces the VPS in `deploy/aws-lightsail`
until the cutover.

## What is where

| Thing | Where |
| --- | --- |
| Database | D1 `judge` (staging: `judge-staging`), schema in `migrations/` |
| Rate limits | Durable Object `RateLimiter` (`cloudflare/rate-limiter.ts`) |
| Judging after the response | Durable Object `JobRunner` calls `/api/internal/job` |
| Timers | Cron Triggers in `wrangler.jsonc`, tasks in `lib/cron.ts` |
| Backups | R2 `judge-backups` (`db/` nightly copies, `removals/` removal log) |
| Errors | Sentry through `@sentry/cloudflare` in `cloudflare/worker.ts` |

## Schema changes

`npx tsx scripts/d1-schema.ts` writes `migrations/0001_schema.sql` from the same
ensure code the Node server runs. After the first deploy, a schema change is a
new numbered file in `migrations/` (and the ensure code), applied with
`npx wrangler d1 migrations apply DB -e staging --remote`.
`test/d1-schema.test.ts` fails when 0001 and the ensure code drift apart.

## Secrets

Set each with `npx wrangler secret put NAME -e staging` (or `secret bulk`).

    BETTER_AUTH_SECRET  ORIGINALS_KEY  RATE_LIMIT_SALT  ANTHROPIC_API_KEY
    RESEND_API_KEY  REVENUECAT_WEBHOOK_SECRET  REVENUECAT_API_KEY
    GOOGLE_CLIENT_SECRET  APPLE_PRIVATE_KEY_BASE64  TURNSTILE_SECRET_KEY
    REVIEW_ACCOUNT_CODE  SENTRY_DSN
    JOB_SECRET  METRICS_TOKEN                 (32+ characters, new for Workers)
    BACKUP_PASSPHRASE

Plain variables (not secret): `BETTER_AUTH_URL`, `NEXT_PUBLIC_SITE_URL`,
`EMAIL_FROM`, `CONTACT_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`,
`GOOGLE_ANDROID_CLIENT_ID`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
`APPLE_APP_BUNDLE_ID`, `REVIEW_ACCOUNT_EMAIL`, `PREMIUM_ENABLED`,
`PURCHASES_ENABLED`, `ALLOW_SANDBOX_PURCHASES`, and any model or cap settings the VPS sets in
`/etc/verdict/verdict.env`. `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SENTRY_DSN` and
`CONTACT_EMAIL` are also read when the bundle is built, so set them for
`npm run cf:build` too.

Plain variables must be listed in `wrangler.jsonc` (per environment); a deploy
removes any that are only set in the dashboard.

No Cloudflare API token goes in the Worker: a D1 token reaches every D1
database in the account. The nightly backup reads the database through the
binding (`lib/backup-dump.ts`).

`IMPORT_ENABLED=1` opens `/api/internal/import` for the data copy; remove it
afterwards. `WIPE_ENABLED=1` also lets the copy script empty the tables first
(`--wipe`, for rehearsals on staging); never set it on production.

## Production resources

Everything is created in the EU, as the privacy text says. Staging has been
made this way (names with `-staging`); production is the same without it:

    npx wrangler d1 create judge --jurisdiction eu
    npx wrangler r2 bucket create judge-backups --jurisdiction eu
    # put the new D1 database_id into wrangler.jsonc (top level), then
    npx wrangler d1 migrations apply DB --remote
    npx wrangler secret put <NAME>          # each secret above, new JOB_SECRET, METRICS_TOKEN, BACKUP_PASSPHRASE
    npm run cf:build && npx wrangler deploy

Plain variables are in `wrangler.jsonc` and are rewritten on every deploy.
`ALLOW_SANDBOX_PURCHASES` is "1" only while App Review is pending (README.md,
"Sandbox purchases"); drop it from `vars` in the deploy that follows approval.

Backups: set an R2 lifecycle rule on `judge-backups` that deletes objects under
`db/` after 30 days, as a hard cap in case the nightly pruning ever fails
(Dashboard > R2 > judge-backups > Settings > Object lifecycle rules, or
`npx wrangler r2 bucket lifecycle add judge-backups ... --jurisdiction eu`).
Objects under `removals/` are the removal log: expire them after 100 days at most.

## Local checks

    npm run cf:build
    node scripts/cf-smoke.mjs      # wrangler dev with fake Resend and Anthropic

The smoke test needs no Cloudflare account. `cloudflare.yml` runs both.

## Restore

`npx wrangler d1 time-travel restore judge --timestamp <iso>` for the last 30
days. For an off-platform copy: download it, then check it with the drill:

    npx wrangler r2 object get judge-backups/db/<name> --remote --jurisdiction eu --file copy.jbk
    BACKUP_PASSPHRASE=... npx tsx scripts/backup-open.ts copy.jbk --drill

To load a copy into a new D1 database, make a SQLite file
(`... backup-open.ts copy.jbk --sqlite copy.db`) and run `scripts/d1-copy.ts`
on it. `wrangler d1 execute --file` cannot load rows over about 100 KB (long
verdicts, sealed originals); d1-copy sends values as bound parameters.
After any restore, replay the removal log, 50 entries a call; repeat with
`&cursor=<next>` from the answer until `next` is null:
`curl -X POST -H "x-internal-secret: $JOB_SECRET" "https://<host>/api/internal/cron?task=replay-removals"`.
