# Judge mobile apps

Native apps for okjudge.com: `android/` (Kotlin, Jetpack Compose) and `ios/`
(SwiftUI, plain Xcode project `ios/Judge.xcodeproj`). They talk
to the same `/api/v1` JSON API as the website (see "API for mobile" in the
root README).

## Shared copy and fixtures (`shared/`)

The copy lives in `lib/i18n.ts` (English) and `lib/locales/<code>.ts` (every
other language); the apps never get a hand-edited copy of it. App-only text is
in `shared/strings/app-strings.ts` (English) and `shared/strings/locales/<code>.ts`,
and the key list in `shared/strings/keys.ts`. After changing any of them,
regenerate from the repo root:

```sh
npm ci
npm run check:app-locales                           # app-only strings of every language
npx tsx mobile/shared/strings/export-strings.ts     # strings.xml, Strings.kt, Localizable.xcstrings, L10n.swift
npx tsx mobile/shared/fixtures/export-fixtures.ts   # golden test data from the web's display logic
```

Both exports accept `--check`, which exits non-zero when a committed file is
stale. The generated files are committed so neither native build needs Node.

- Every enabled language of `lib/langs.ts` is exported. One without its
  `shared/strings/locales/<code>.ts` yet reads English for the app-only keys.
- `{name}` slots become positional arguments numbered by their order in the
  English string (`%1$s` on Android, `%1$@` on iOS).
- Count strings (`COUNT_KEYS` on the web, `APP_COUNT_KEYS` here) become one
  plural (`R.plurals.*`, an `.xcstrings` plural variation) with every plural
  category of the language, counted by `{n}`. Where the web says 1 with a key
  of its own (`SINGULAR_KEYS` in `keys.ts`), the accessor returns that key
  for exactly 1.
- The export also keeps `res/xml/locales_config.xml`, `CFBundleLocalizations`
  in `ios/Judge/Info.plist` and the project's `knownRegions` in step with the
  languages.
- Leading emoji that the web design strips at render time are stripped in
  the export (`STRIP_EMOJI` in `keys.ts`).

## Balance scene (`shared/scene/`)

The judging card shows the web's three.js balance in a web view. `npm run scene:build`
bundles `shared/scene/scene.ts` into one offline page, written to
`android/app/src/main/assets/scene/index.html` and `ios/Judge/Resources/Scene/index.html`
(`--check` as above). Rebuild after changing the engine or anything it imports from `lib/`.
Native code calls `window.judgeScene.setMode(...)`, `setReduced`, `setPointer` and `reset`
and hears back `ready`, `fallback` and `lost` through the `judgeScene` message handler (iOS) or
the `JudgeScene` JavaScript interface (Android).
