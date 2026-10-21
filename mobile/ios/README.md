# Judge for iOS

SwiftUI app for okjudge.com. Swift 6 language mode, iOS 17+, Observation,
URLSession, Codable and SwiftData; no third-party packages. `Judge.xcodeproj`
is committed and needs no generator.

## Build on a Mac

Requirements: Xcode 16 or newer (Swift 6 compiler and the synchronized-folder
project format; Xcode 26 recommended). Nothing else to install.

```sh
open mobile/ios/Judge.xcodeproj
```

Pick the **Judge** scheme and an iPhone simulator (iOS 17 or newer), then Run
(Cmd-R). Tests: Cmd-U.

The project uses synchronized folders: everything under `Judge/` belongs to
the app, and everything under `JudgeTests/` and `../shared/fixtures` to the
tests (see Tests). Adding, renaming or deleting a file needs no project edit.
Exceptions: `Judge/Info.plist` is not copied as a resource and
`export-fixtures.ts` is in neither target. The app takes only
`verdicts.json` from the fixtures folder, as an explicit file reference
(Debug builds only, see Screenshot states), so a new fixture file never
ends up in the app.

### Running on a device

Signing is automatic. Put your team id in `Config/Signing.xcconfig`
(gitignored):

```
DEVELOPMENT_TEAM = ABCDE12345
```

then select your phone as the destination.

### Command line (CI / SSH)

```sh
cd mobile/ios
xcodebuild -list -project Judge.xcodeproj
xcrun simctl list devices available | grep -i iphone    # pick a simulator name
xcodebuild   -project Judge.xcodeproj   -scheme Judge   -destination 'platform=iOS Simulator,name=iPhone 17,OS=latest'   -derivedDataPath build/DerivedData   CODE_SIGNING_ALLOWED=NO   build test
```

Swap `iPhone 17` for a simulator listed by `simctl` on that Mac. Test results
are in `build/DerivedData/Logs/Test`; add `-resultBundlePath build/Judge.xcresult`
to keep a result bundle.

A release archive (needs signing and a team id):

```sh
xcodebuild -project Judge.xcodeproj -scheme Judge -configuration Release   -destination 'generic/platform=iOS' -archivePath build/Judge.xcarchive archive
```

### Screenshot states (Debug builds)

Debug builds accept `-JudgeScreenshotState <screen>:<lang>` and render a fixed
state from `mobile/shared/fixtures/verdicts.json`, with an in-memory history,
a separate defaults suite and no network (the API points at a closed local
port). Screens: `home`, `home-error`, `judging`, `history`, `settings`,
`signin`, `signin-code`, `account` (Settings, signed in with a fixture
account), `verdict/<sample>` for any key of `verdictResponses`, and the
Premium states `tier/locked` (monthly allowance used up), `tier/premium`
(Premium chosen, credits left), `pricing`, `clarify`, `evidence` (picked
screenshots in mixed states) and `judging-premium`.
Languages: `en`, `tr`.

```sh
APP=build/DerivedData/Build/Products/Debug-iphonesimulator/Judge.app
xcrun simctl boot "iPhone 17"
xcrun simctl install "iPhone 17" "$APP"
xcrun simctl launch "iPhone 17" com.okjudge.judge -JudgeScreenshotState verdict/win_a_self:tr
xcrun simctl io "iPhone 17" screenshot win_a_self_tr.png
```

Release builds contain neither the hook (`#if DEBUG`) nor the fixture file
(`EXCLUDED_SOURCE_FILE_NAMES = verdicts.json` in the Judge Release
configuration).

## Configuration

`Config/Shared.xcconfig`, `Debug.xcconfig` and `Release.xcconfig` fill three
Info.plist keys that `AppConfig` reads at launch:

| Setting | Info.plist key | Default |
|---|---|---|
| `API_BASE_URL` | `JudgeAPIBaseURL` | `https://okjudge.com` |
| `SHARE_BASE_URL` | `JudgeShareBaseURL` | the API base |
| `TURNSTILE_SITE_KEY` | `JudgeTurnstileSiteKey` | empty (no bot check) |

To point a Debug build at another server, create `Config/Local.xcconfig`
(gitignored; only Debug includes it):

```
API_BASE_URL = http:/$()/192.168.1.20:3000
TURNSTILE_SITE_KEY =
```

`$()` stops `//` from being read as a comment. Plain `http` works for local
network addresses (`NSAllowsLocalNetworking`).

**Bot check.** With `TURNSTILE_SITE_KEY` empty the app sends no Turnstile
token, which only works against a server without `TURNSTILE_SECRET_KEY`; a
server with the secret set answers such requests with `403 captcha_failed`.
With the key set, the app runs an invisible Turnstile widget in a web view
whose base URL is the API origin (`TurnstileBotCheck`); when Cloudflare asks
for a tap, the widget appears in a sheet. The check runs before the judging
cover is presented (the sheet hangs off the root view, which cannot present
over the cover). Whether Cloudflare accepts tokens from a web view has to be
tried against production before release.

## Sign-in

Getting a verdict needs an account. Tapping "Get the verdict" while signed
out opens the sign-in sheet and submits once the user has signed in; Settings
has an Account section (plan, credits, sign out, delete account). The sheet
shows only the methods `GET /api/v1/config` reports (`signIn.apple`,
`signIn.google`, `signIn.emailCode`), Apple first.

- **Apple**: `ASAuthorizationController` with a SHA-256 hashed nonce; the
  identity token and the raw nonce go to `POST /api/auth/sign-in/social`.
  Needs the Sign in with Apple capability (`Judge/Judge.entitlements`) on
  the App ID; device builds pick it up through automatic signing.
- **Google**: no SDK. `ASWebAuthenticationSession` runs an OAuth code flow
  with PKCE against accounts.google.com using the iOS client id, the app
  trades the code for an ID token at oauth2.googleapis.com (installed-app
  clients have no secret) and sends that, with the raw nonce from the
  authorization request, to `/api/auth/sign-in/social`. The
  redirect scheme (the reversed client id) is registered in Info.plist. The
  server must list the iOS client id in `GOOGLE_IOS_CLIENT_ID`.
- **Email code**: `POST /api/auth/email-otp/send-verification-otp?lang=…`,
  then `POST /api/auth/sign-in/email-otp` with the six digits.

The session token lives in the Keychain (`KeychainTokenStore`, readable
after first unlock, this device only) and goes out as `Authorization:
Bearer`. A `401 signin_required`, or `/api/v1/me` answering without a user,
signs the app out and offers sign-in again. Sign out and delete account
forget the token; neither touches the on-device history.

## Premium

The website's Premium flow, natively (lib/tier.ts, app/page.tsx):

- **Free / Premium** on Home when `GET /api/v1/config` has `premiumEnabled`.
  Whether Premium can be picked follows `/api/v1/me` (`canUsePremium`);
  the pick is remembered in UserDefaults, and a remembered Premium only
  counts while it can be used. The note under the switch links to sign-in
  or to the pricing screen (also in Settings). Buy buttons stay disabled
  until purchases arrive with the store build.
- **Questions first**: `POST /api/v1/clarify`. 400/401/402/403 stop on the
  form (401 signs out, 402 refreshes the account); anything else judges
  without questions. Up to two questions replace the form; skipping sends
  them with empty answers.
- **The verdict**: `POST /api/v1/verdict` with `tier: "premium"`, an
  `Idempotency-Key` kept for retries of the same body (dropped after a
  success) and `Prefer: respond-async`. `409 in_progress` is asked again
  every 4 s for up to 300 s; a 202 is polled like a free verdict. The
  answer's entitlement shows at once and `/me` is refetched after every
  outcome.
- **Screenshots** (when `features.evidence`): up to three from the photo
  library, downscaled to 1600 px and re-encoded as JPEG on white (no EXIF),
  except small PNG and GIF files; each uploads at once to
  `POST /api/v1/evidence` (multipart, `image` parts). Only the tokens of
  images read successfully are sent, in order; images still being read
  hold the submit.

## Layout

```
Judge.xcodeproj              targets Judge, JudgeTests; shared scheme Judge
Config/                      xcconfigs
Judge/
  App/                       JudgeApp (root view, tabs), AppModel, AppConfig,
                             ScreenshotState (Debug-only fixture states)
  Core/API/                  JudgeAPI (URLSession), verdict polling, APIError, BotCheck, TokenStore
  Core/Auth/                 AccountModel, account API calls, Keychain token store, Apple/Google
  Core/Model/                Codable wire models, raw-JSON-preserving decoding
  Core/Display/              ports of the website's display logic (pure)
  Core/Data/                 SwiftData SavedVerdict + HistoryStore
  UI/                        Theme, Components, Home, Judging, Verdict, History, Settings, Account
  Generated/L10n.swift       GENERATED by mobile/shared/strings/export-strings.ts
  Resources/Localizable.xcstrings  GENERATED (same script)
  Resources/Assets.xcassets  app icon, launch mark, accent and launch colours
  Resources/Fonts/           Inter, Inter Tight (variable), Instrument Serif
  Resources/Licenses/        OFL texts for the fonts
JudgeTests/                  XCTest suites; fixtures come from ../shared/fixtures
```

Never edit the generated strings by hand. Change `lib/i18n.ts` (or
`mobile/shared/strings/app-strings.ts`) and run, from the repo root:

```sh
npx tsx mobile/shared/strings/export-strings.ts
```

## Tests

`JudgeTests` runs inside the app (hosted tests) so the string catalog is
available. It covers:

- the display ports against `mobile/shared/fixtures/display-vectors.json`
  (party names, verdict labels, tug and tilt, crux style, lean tally, share
  URL, waits, error messages, confidence text, preset emoji, palette, judging
  timeline), computed by the website's own code;
- decoding of every sample body, absent vs `null` lean, unknown enum values;
- the judging state machine, the progress bar and the balance motion;
- error mapping, and `JudgeAPI` against a stub `URLProtocol` (headers,
  timeouts, every error body, 524 and 504, HTML 5xx, offline, no automatic
  retry);
- async verdicts (`Prefer: respond-async`, 202, then polling
  `GET /api/v1/verdicts/{id}`): name map and owner token kept from the 202,
  failed jobs, transient poll errors, the deadline, cancellation, and the
  direct 200 answer;
- `HistoryStore` with an in-memory SwiftData container;
- the Debug screenshot states (parsing, fixtures, no network).

`LiveAPITests` sends one real free verdict and is skipped unless
`JUDGE_LIVE_BASE_URL` is set. It costs a few cents and a rate-limit slot, so
run it on purpose only:

```sh
TEST_RUNNER_JUDGE_LIVE_BASE_URL=https://okjudge.com xcodebuild   -project Judge.xcodeproj -scheme Judge   -destination 'platform=iOS Simulator,name=iPhone 17'   CODE_SIGNING_ALLOWED=NO -only-testing:JudgeTests/LiveAPITests test
```

`TEST_RUNNER_JUDGE_LIVE_TURNSTILE_TOKEN` passes a bot-check token for servers
that require one.

## Assets

- **Fonts** (SIL OFL) from github.com/google/fonts, renamed on copy:
  `Inter.ttf` = `ofl/inter/Inter[opsz,wght].ttf`,
  `InterTight.ttf` = `ofl/intertight/InterTight[wght].ttf`,
  `InstrumentSerif-Regular.ttf`, `InstrumentSerif-Italic.ttf` from
  `ofl/instrumentserif/`. PostScript names: `Inter-Regular`,
  `InterTight-Regular`, `InstrumentSerif-Regular`, `InstrumentSerif-Italic`.
  Weights are set through the variation axes (`BrandFont`).
- **Icon and launch mark** are rendered from the brand mark geometry
  (`app/icon.svg`): a 1024 px opaque PNG for the icon, and a transparent
  mark at @1x/@2x/@3x for the launch screen.
