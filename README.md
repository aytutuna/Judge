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
   kept for up to 24 hours. The store is Upstash Redis when configured, else
   the app's memory, optionally logged to `RATE_LIMIT_DB` so restarts keep
   it. If Redis or that log is down or slow, requests are refused
   (`503 unavailable`) rather than let through unmetered.

Then: API key check → anonymize → judges → crux trial → save.

The visitor IP comes from the first `X-Forwarded-For` entry, so it is only
trustworthy behind a proxy that overwrites that header: Vercel does, and so
does the Caddy setup in the Lightsail guide below.

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
  `sudo bash /opt/verdict/repo/deploy/aws-lightsail/setup.sh --reconfigure`.
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
