# Store listing drafts

Drafts for the App Store and Google Play listings of Judge (okjudge.com).

- `listing-en.md`: name, subtitle, short description, promotional text, full description, keywords and what's new in 1.0, then the English-only parts: URLs, categories, age rating answers and App Privacy / Data safety answers.
- The other `listing-*.md` files: the same seven fields in every other app language, plus the English, Spanish and French store variants. Headings stay in English. See the locale table below.
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
| What's new | 500 |

Count characters, not bytes: Indic scripts use a lot of combining marks, and several listings sit right at the limit.

## Store locales

Codes as App Store Connect and the Play Console spell them. Google Play has no Odia, so `listing-or.md` is App Store only.

| File | App Store Connect | Google Play |
|---|---|---|
| listing-en.md | en-US | en-US |
| listing-en-GB.md | en-GB | en-GB |
| listing-en-AU.md | en-AU | en-AU |
| listing-en-CA.md | en-CA | en-CA |
| listing-ar.md | ar-SA | ar |
| listing-bn.md | bn-BD | bn-BD |
| listing-ca.md | ca | ca |
| listing-zh-Hans.md | zh-Hans | zh-CN |
| listing-zh-Hant.md | zh-Hant | zh-TW |
| listing-hr.md | hr | hr |
| listing-cs.md | cs | cs-CZ |
| listing-da.md | da | da-DK |
| listing-nl.md | nl-NL | nl-NL |
| listing-fi.md | fi | fi-FI |
| listing-fr.md | fr-FR | fr-FR |
| listing-fr-CA.md | fr-CA | fr-CA |
| listing-de.md | de-DE | de-DE |
| listing-el.md | el | el-GR |
| listing-gu.md | gu-IN | gu |
| listing-he.md | he | iw-IL |
| listing-hi.md | hi | hi-IN |
| listing-hu.md | hu | hu-HU |
| listing-id.md | id | id |
| listing-it.md | it | it-IT |
| listing-ja.md | ja | ja-JP |
| listing-kn.md | kn-IN | kn-IN |
| listing-ko.md | ko | ko-KR |
| listing-ms.md | ms | ms, ms-MY |
| listing-ml.md | ml-IN | ml-IN |
| listing-mr.md | mr-IN | mr-IN |
| listing-nb.md | no | no-NO |
| listing-or.md | or-IN | - |
| listing-pl.md | pl | pl-PL |
| listing-pt-BR.md | pt-BR | pt-BR |
| listing-pt-PT.md | pt-PT | pt-PT |
| listing-pa.md | pa-IN | pa |
| listing-ro.md | ro | ro |
| listing-ru.md | ru | ru-RU |
| listing-sk.md | sk | sk |
| listing-sl.md | sl-SI | sl |
| listing-es.md | es-ES | es-ES |
| listing-es-MX.md | es-MX | es-419 |
| listing-sv.md | sv | sv-SE |
| listing-ta.md | ta-IN | ta-IN |
| listing-te.md | te-IN | te-IN |
| listing-th.md | th | th |
| listing-tr.md | tr | tr-TR |
| listing-uk.md | uk | uk |
| listing-ur.md | ur-PK | ur |
| listing-vi.md | vi | vi |

## Rules for the copy

- Never name the AI vendor or model: say "AI judges" or "an outside AI service".
- The app requires sign-in (Apple, Google or an emailed code).
- No prices in the copy: the stores show them. The monthly plan's cap is stated as "35 verdicts a month" (the number from `lib/pricing.ts`).
- There is no free tier: a new account's first verdict is free, then credit packs or the monthly plan.
- No legal advice claims.
- Source of facts: `lib/i18n.ts`, `lib/pricing.ts` and the privacy page in the web repo. Update these files when that copy changes.
