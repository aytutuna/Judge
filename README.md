# ⚖️ Verdict

Tell it the argument. It digs to bedrock and rules.

Verdict is a mobile-first web app that settles arguments: one person describes a
disagreement, and an AI judge steelmans both sides, maps each side's claims down
to its **bedrock** premise, finds the **crux** — the one point the fight is
actually about — and renders a verdict.

## Honest verdicts, always labeled

Verdict never launders an opinion through a confident interface. Every ruling
carries an explicit type:

| Verdict | When |
|---|---|
| **Party A / B is right** | The default. A checkable fact, a logical error, ordinary usage of a word, or a sensible common-sense framework favors one side — and the facts the ruling leans on are listed so you can check them |
| **Split decision** | Each side is right about a different part, and both parts matter about equally |
| **It depends on your values** | Only when the value frameworks are genuinely balanced — you get "if you weight X → then Y" branches instead of fake certainty |
| **Same word, different meanings** | Only when both uses of the word are fully standard and the argument dissolves once definitions are separated |
| **Too close to call** | The independent judges couldn't agree, and their forced rulings don't unanimously favor a side that one of them ruled for |

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
Fact/logic winner rulings are then cross-examined — an adversarial attack on
the crux, judged by a separate referee; a ruling that does not survive keeps
its verdict but its confidence is capped, and the attack is shown.

**Privacy = fairness**: before judging or storing anything, names are replaced
with *Party A* / *Party B*. The judge never knows who is who — which is also the
bias mitigation — and only the anonymized text is stored. The anonymizer is
itself a Claude call, so the raw text, names included, does go to Anthropic
once; the privacy page says so. The name map returns to your browser only. If anonymization fails for any reason (refusal, quota,
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
| `DATABASE_URL` | `file:./dev.db` | Local SQLite file, or a Turso `libsql://…` URL in production |
| `DATABASE_AUTH_TOKEN` | *(empty)* | Turso database token (only for a `libsql://` URL) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | *(empty)* | Upstash Redis for rate limits shared by every server instance. Unset = in-memory limits, which only hold within one process (fine for local dev, not for a public deploy) |
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
| `CRUX_TRIAL` | `1` | Cross-examination of fact/logic winner rulings (up to 2 extra calls). Set `0` to skip it |

**Cost and latency:** one verdict costs 1 anonymizer call + `JUDGE_RUNS` judge
calls (in parallel), plus up to 2 sequential trial calls when a fact/logic
winner is declared, so winner verdicts take a little longer. Measured on
Haiku 5.5 ($0.10 / $0.50 per 1M input / output tokens), a judge call uses
about 3,050 input and 1,300 output tokens, so a full verdict (3 judges +
anonymizer + up to 2 trial calls) costs roughly **$0.004–0.006** — about
**$4–6 per 1,000 verdicts**. With the default `DAILY_VERDICT_CAP=1000`, the
worst case is about $6 a day. Each call has a fixed time budget (60s for
the anonymizer, 120s for judges, 60s total for the trial), so a verdict never
hangs indefinitely. The SDK retries rate-limit and overload errors
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
   kept for up to 24 hours. If Redis is down or slow, requests are refused
   (`503 unavailable`) rather than let through unmetered.

Then: API key check → anonymize → judges → crux trial → save.

## Deploy to Vercel

You need free accounts on GitHub, Vercel, Turso, Upstash and Cloudflare, plus
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
npm test        # unit tests: aggregation, rate limits, bot check, route gates, storage
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
