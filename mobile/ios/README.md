# Judge for iOS

SwiftUI app for okjudge.com. Swift 6 language mode, iOS 17+, Observation,
URLSession, Codable and SwiftData. One Swift package: RevenueCat
(github.com/RevenueCat/purchases-ios-spm, pinned to an exact version in the
project) for in-app purchases; Xcode and `xcodebuild` fetch it on the first
build. `Judge.xcodeproj` is committed and needs no generator.

## Build on a Mac

Requirements: Xcode 16 or newer (Swift 6 compiler and the synchronized-folder
project format; Xcode 26 recommended). Nothing else to install; the first
build needs network access to fetch the RevenueCat package.

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

### TestFlight

`.github/workflows/testflight.yml` archives the app and uploads it to
TestFlight on every push to `feature/mobile` that touches `mobile/ios` or
`mobile/shared` (or by hand from the Actions tab). It signs with an Apple
Distribution certificate (`IOS_DIST_P12_BASE64`, `IOS_DIST_P12_PASSWORD`)
and the App Store profile "Judge App Store CI" (`IOS_PROFILE_BASE64`), written
into a gitignored `Config/Signing.xcconfig` on the runner. The upload uses an
App Store Connect API key: the `.p8` file in the `ASC_API_KEY_P8` secret, its
key id and issuer id in the `ASC_KEY_ID` and `ASC_ISSUER_ID` repository
variables. The profile expires after a year; make a new one with the same
name and replace the secret. The build number is the workflow's run number, so
`CURRENT_PROJECT_VERSION` in `Shared.xcconfig` only matters for local builds;
bump `MARKETING_VERSION` there for a new release.

### Screenshot states (Debug builds)

Debug builds accept `-JudgeScreenshotState <screen>:<lang>` and render a fixed
state from `mobile/shared/fixtures/verdicts.json`, with an in-memory history,
a separate defaults suite and no network (the API points at a closed local
port). Screens: `home`,
`home-example` (both sides from "Try an example"), `home-error`, `judging`, `history`, `settings`, `signin`, `signin-code`,
`account` (Settings, signed in with a fixture account), `verdict/<sample>`
for any key of `verdictResponses` (opened as a saved verdict),
`verdict-thread` (a fresh verdict under its argument), `verdict-context`,
`verdict-context-locked` and `verdict-context-limit` (the writer's "Add
context" form, its Premium lock and the limit note), and the
account states `balance/welcome` (a new account's free verdict),
`balance/none` (monthly allowance used up), `pricing`, `pricing-store`
(store prices on the buy buttons, from a fake store), `pricing-buy` (the
same, scrolled to the packs and the monthly plan), `clarify` and
`evidence` (picked screenshots in mixed states), and the case states
`mode-both`, `history-cases` (the account's list with every kind of row and
a verdict kept only on the phone), `history-select` (select mode, two rows
picked) and `case/<state>` (a key of `cases.views` or
`awaiting`, `judging`, `judged`, `one-sided`, `appeal`, `appeal-judging`,
`failed`, `expired`, `removed`; Turkish takes the `_tr` view if there is one).
Languages: `en`, `tr`. Add `:dark` (`home:en:dark`) for the dark appearance;
without it a state is light whatever the simulator uses. These states draw
the flat balance in place of the bundled 3D scene, so the shots match from
run to run.

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
| `REVENUECAT_API_KEY` | `JudgeRevenueCatAPIKey` | empty (no in-app purchases) |

To point a Debug build at another server, create `Config/Local.xcconfig`
(gitignored; only Debug includes it):

```
API_BASE_URL = http:/$()/192.168.1.20:3000
```

`$()` stops `//` from being read as a comment. Plain `http` works for local
network addresses (`NSAllowsLocalNetworking`).

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
forget the token and take the account's verdicts off the phone (they come
back from the account on sign-in); verdicts no account has stay. An expired
session keeps them, unlisted, until the next sign-in.

## Premium

Every verdict is Premium and costs one unit: a credit, or one of the
monthly plan's 35. A new account starts with one credit. The website's
flow, natively (app/page.tsx):

- **Balance**: the line under "Get the verdict" reads `/api/v1/me`
  (monthly allowance first, then credits). With nothing left, "Get the
  verdict" and "Or send them a link" open the pricing screen (also in
  Settings) instead; a `402` (`no_credits`, `fair_use`) from the server
  does the same. Buying: see Purchases.
- **Questions first**: `POST /api/v1/clarify`. 400/401/402/403 stop on the
  form (401 signs out, 402 refreshes the account); anything else judges
  without questions. Up to two questions replace the form; skipping sends
  them with empty answers.
- **The verdict**: `POST /api/v1/verdict` with `tier: "premium"`, an
  `Idempotency-Key` kept for retries of the same body (dropped after a
  success) and `Prefer: respond-async`. `409 in_progress` is asked again
  every 4 s for up to 300 s; a 202 is polled until it is ready. The
  answer's entitlement shows at once and `/me` is refetched after every
  outcome.
- **Screenshots** (when `features.evidence`): up to three from the photo
  library, downscaled to 1600 px and re-encoded as JPEG on white (no EXIF),
  except small PNG and GIF files; each uploads at once to
  `POST /api/v1/evidence` (multipart, `image` parts). Only the tokens of
  images read successfully are sent, in order; images still being read
  hold the submit.
- **Both sides** (when `features.cases`): "Or send them a link" on Home
  creates a case, which costs a verdict
  (`POST /api/v1/cases` with an `Idempotency-Key`); the returned name map is
  kept in the Keychain per case (`KeychainCaseNamesStore`) as the fallback
  for `case.names`. The case page polls `GET /api/v1/cases/{id}` every
  `pollAfterMs` while something is judging (backing off to 30 s on errors)
  and offers the invite link (copy, share sheet, new link), judging on the
  owner's side alone, retry, removal, the names on the share pages and
  adding context (appeals). The Verdicts tab lists the account's verdicts
  and cases, started or answered, from `GET /api/v1/me/history`, cached in
  SwiftData so it shows at once and offline. Invite links (`/r/…`) are never answered in the app: they are shared
  as URLs, and one the app is opened with goes to Safari; `/c/{id}` links
  open the case page.

## Purchases

In-app purchases go through RevenueCat (StoreKit 2 underneath); the server
grants them. With `REVENUECAT_API_KEY` set (the public Apple SDK key,
`appl_...`), the app configures the SDK at launch, calls
`Purchases.logIn(<Judge user id>)` whenever a sign-in or `/api/v1/me` brings
the user id (and again right before every purchase and restore), and
`logOut()` when the session ends, so RevenueCat's `app_user_id` is the Judge
user id. Log-ins and log-outs reach the SDK in order, and the purchase sheet
opens only while the SDK's `appUserID` is the signed-in user's id. The RevenueCat webhook turns purchases into credits and
subscriptions on the server; the app only shows what `/me` says.

- **Pricing screen**: when `GET /api/v1/config` has
  `pricing.purchasesEnabled`, a key is set and the current offering has
  loaded, each plan's button shows the store's localized price and buys
  (signing in first when needed). After a purchase the screen says thanks
  and asks `/me` again over about 10 s until the balance or subscription
  changes, else it says the purchase may take a minute to show up.
  Cancelling says nothing; any other failure shows one generic message.
  Otherwise the buttons read "Coming soon".
- **Settings, Account**: "Restore purchases" (when the server allows
  purchases and a key is set), then `/me` again.
- **Products**: the current offering's packages are matched by store
  product id against `STORE_PRODUCTS` in `lib/pricing.ts`, so a product the
  server cannot grant is never sold: `pack_1` and `pack_10` (consumables)
  and `monthly` (auto-renewable subscription).
- In-app purchase needs no entitlement in `Judge.entitlements`; it is
  available to every App ID.

## Usage events

`Analytics` (Core/Analytics) queues the events listed in
`lib/analytics/track.ts` and posts them to `POST /api/v1/events`, with the
bearer token when signed in and `anon_id` always. The queue lives in memory
and in `Application Support/analytics-queue.json` (500 at most, written off
the main actor and kept out of backups) and goes out in batches of up to 50: once 20 are waiting, every 30 s while the app is
active and when it goes to the background. A failed send waits at least a
minute, doubling up to 15; a `400` drops the batch. Nothing is queued while
`features.analytics` in `/api/v1/config` is false or the "Usage statistics"
setting is off (turning it off clears the queue); until the config has
answered, events wait. Each event takes at most one prop (`screen_view`
`screen`, `buy_tapped` `product`, `sign_in_started` `provider`,
`settings_changed` `key`, `error_shown` `code`), a short token; anything else
is refused before it is queued and fails an assertion in Debug. Hosted unit
tests launch the app with usage events off.

The device id is `identifierForVendor` (a UUID kept in UserDefaults when iOS
has none yet). It goes in the events' context and, as `Device-Id` with
`Device-Platform: ios`, on the sign-in requests.

## Layout

```
Judge.xcodeproj              targets Judge, JudgeTests; shared scheme Judge
Config/                      xcconfigs
Judge/
  App/                       JudgeApp (root view, tabs), AppModel, AppConfig,
                             ScreenshotState (Debug-only fixture states)
  Core/API/                  JudgeAPI (URLSession), verdict polling, APIError, BotCheck, TokenStore
  Core/Auth/                 AccountModel, account API calls, Keychain token store, Apple/Google
  Core/Purchases/            PurchaseModel, PurchaseGateway (RevenueCat behind a protocol), PurchaseMessages
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

Never edit the generated strings by hand. Change `lib/i18n.ts` and
`lib/locales` (or `mobile/shared/strings/app-strings.ts` and its `locales`)
and run, from the repo root:

```sh
npx tsx mobile/shared/strings/export-strings.ts
```

## Tests

`JudgeTests` runs inside the app (hosted tests) so the string catalog is
available. It covers:

- the display ports against `mobile/shared/fixtures/display-vectors.json`
  (party names, verdict labels, tug and tilt, crux style, lean tally, share
  URL, waits, error messages, confidence text, palette, judging timeline),
  computed by the website's own code;
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
- purchases against a fake `PurchaseGateway`: offers to button labels, the
  `/me` polling after a purchase, cancel, failure, restore, store log-in and
  log-out with the session, and everything off without a key;
- the Debug screenshot states (parsing, fixtures, no network).

`LiveAPITests` sends one real verdict and is skipped unless
`JUDGE_LIVE_BASE_URL` is set. It costs a few cents and a rate-limit slot, so
run it on purpose only:

```sh
TEST_RUNNER_JUDGE_LIVE_BASE_URL=https://okjudge.com xcodebuild   -project Judge.xcodeproj -scheme Judge   -destination 'platform=iOS Simulator,name=iPhone 17'   CODE_SIGNING_ALLOWED=NO -only-testing:JudgeTests/LiveAPITests test
```

It predates verdicts needing an account and fails against servers that
want one until it passes a session token.

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
