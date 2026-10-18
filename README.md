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
| **Party A / B is right** | The crux is a checkable fact or a logical error — and the facts the ruling leans on are listed so you can check them |
| **Split decision** | Each side is right about a different part |
| **It depends on your values** | The crux is a clash of terminal values — you get "if you weight X → then Y" branches instead of fake certainty |
| **Same word, different meanings** | The argument dissolves once definitions are separated |
| **Too close to call** | The independent judges couldn't agree |

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
bias mitigation — and only the anonymized text is stored. The name map returns
to your browser only.

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
cp .env.example .env    # then add your Gemini key (required)
npm run dev
```

A `GEMINI_API_KEY` is **required** — without one the API refuses to judge
(no canned fallback: this app never fakes a ruling). Get a key at
[Google AI Studio](https://aistudio.google.com/apikey).

> ⚠️ **Never commit `.env`.** If a key has ever been pasted into a chat, issue,
> or commit, rotate it in AI Studio before going public.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Google AI Studio key |
| `GEMINI_MODEL` | `gemini-flash-latest` | Judge model |
| `GEMINI_MODEL_LITE` | `gemini-flash-lite-latest` | Anonymizer model (separate free-tier quota bucket) |
| `JUDGE_RUNS` | `3` | Self-consistency runs per verdict (1–3). Lower it on tight quotas; confidence is capped accordingly |
| `CRUX_TRIAL` | `1` | Cross-examination of fact/logic winner rulings (up to 2 extra flash calls). Set `0` on tight quotas |
| `DATABASE_URL` | `file:./dev.db` | Local libSQL file, used when Turso is not configured |
| `TURSO_DATABASE_URL` | *(unset)* | Turso database URL (`libsql://…`); required on Vercel, where a file DB cannot persist |
| `TURSO_AUTH_TOKEN` | *(unset)* | Turso auth token for that database |

**Free-tier reality check:** one verdict costs 1 lite call + `JUDGE_RUNS` flash
calls, plus up to 2 trial calls when a fact/logic winner is declared — on the
free tier the trial's calls land in the same per-model rate bucket as the
judges, so winner verdicts can take roughly 30–60 s longer. The Gemini free
tier allows only a handful of flash requests per minute
and a small daily cap, so for anything public use a paid-tier key (still cheap —
flash pricing is fractions of a cent per verdict) or set `JUDGE_RUNS=1`.

### Storage

Verdicts live in libSQL: a local file in development and tests, Turso in
production. The schema is versioned in `lib/migrations.ts` (append new
migrations, never edit shipped ones). The app applies pending migrations on its
first query; you can also apply them explicitly, e.g. before a deploy:

```bash
npm run db:migrate   # uses TURSO_* if set, else DATABASE_URL; reads .env.local / .env
```

## How it works

```
input ──▶ anonymize (names → Party A/B) ──▶ judge ×N (structured JSON)
                                                 │
   stored: anonymized text + result only         ▼
   share link /v/[id]  ◀── libSQL ◀── aggregate (majority vote → confidence)
```

- One well-crafted structured-output prompt does parse → steelman → classify
  claims (fact / value / definition / logic) → bedrock → crux → verdict
  (`lib/judge.ts`), forced through a `responseSchema` so it always parses.
- The value framework (preset chips + fine-tuning sliders) is injected into the
  prompt and only matters when the crux is a values clash (`lib/frameworks.ts`).
- Aggregation and the confidence rules live in `lib/aggregate.ts`.
- If the model's own safety filter refuses, the app says so honestly instead of
  inventing a ruling.

## Testing

```bash
npm test        # unit tests: aggregation rules, thinking timeline, storage, test-set shape
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
