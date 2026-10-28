# Store listing drafts

Drafts for the App Store and Google Play listings of Judge (okjudge.com).

- `listing-en.md`, `listing-tr.md`: name, subtitle and short description options, promotional text, full description, keywords, what's new in 1.0, URLs, categories, age rating answers and App Privacy / Data safety answers.
- `review-notes.md`: notes for App Review. Fill in `<REVIEW_EMAIL>` and `<REVIEW_CODE>` with the reviewer test account before submitting: the values of `REVIEW_ACCOUNT_EMAIL` and `REVIEW_ACCOUNT_CODE` on the server, which make that address always accept that code (see the web repo README).

Before every submission give that account credits on the server, since every verdict, case and appeal costs one and the account only got the single welcome credit (or none, if it is older than the welcome credit). From the app directory: `sudo -u verdict npx tsx --env-file=/etc/verdict/verdict.env scripts/grant.ts <REVIEW_EMAIL> --credits 20 --create`, then `--show` to check the balance. Sandbox purchases don't add anything on the live server (`ALLOW_SANDBOX_PURCHASES` stays unset), so the notes don't promise that they do.

## Character limits

| Field | Limit |
|---|---|
| App name | 30 |
| App Store subtitle | 30 |
| Google Play short description | 80 |
| App Store promotional text | 170 |
| Full description (both stores) | 4000 |
| App Store keywords | 100, comma separated, no spaces after commas, no repeats of the name |

## Rules for the copy

- Never name the AI vendor or model: say "AI judges" or "an outside AI service".
- The app requires sign-in (Apple, Google or an emailed code).
- No prices in the copy: the stores show them. The monthly plan's cap is stated as "35 verdicts a month" (the number from `lib/pricing.ts`).
- There is no free tier: a new account's first verdict is free, then credit packs or the monthly plan.
- No legal advice claims.
- Source of facts: `lib/i18n.ts`, `lib/pricing.ts` and the privacy page in the web repo. Update these files when that copy changes.
