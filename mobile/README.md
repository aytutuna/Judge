# Judge mobile apps

Native apps for okjudge.com: `android/` (Kotlin, Jetpack Compose) and `ios/`
(SwiftUI, plain Xcode project `ios/Judge.xcodeproj`). They talk
to the same `/api/v1` JSON API as the website (see "API for mobile" in the
root README).

## Shared copy and fixtures (`shared/`)

The EN/TR copy lives in `lib/i18n.ts`; the apps never get a hand-edited
copy of it. After changing a string there (or in
`shared/strings/app-strings.ts` for app-only text, or the key list in
`shared/strings/keys.ts`), regenerate from the repo root:

```sh
npm ci
npx tsx mobile/shared/strings/export-strings.ts     # strings.xml, Strings.kt, Localizable.xcstrings, L10n.swift
npx tsx mobile/shared/fixtures/export-fixtures.ts   # golden test data from the web's display logic
```

Both accept `--check`, which exits non-zero when a committed file is stale.
The generated files are committed so neither native build needs Node.

- `{name}` slots become positional arguments numbered by their order in the
  English string (`%1$s` on Android, `%1$@` on iOS).
- Keys ending in `.one` / `.other` become one plural (`R.plurals.*`, an
  `.xcstrings` plural variation) counted by `{n}`.
- Leading emoji that the web design strips at render time are stripped in
  the export (`STRIP_EMOJI` in `keys.ts`).
