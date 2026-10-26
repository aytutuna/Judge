import SwiftUI

/// "Your name on the shared verdict" under "Create the invite": prefilled
/// with the account's first name until the user types (at most 40 characters).
struct CaseNameField: View {
    let home: HomeModel
    /// The account first name the field falls back to.
    let fallback: String
    let lang: AppLang
    let disabled: Bool
    @State private var text: String

    @MainActor
    init(home: HomeModel, fallback: String, lang: AppLang, disabled: Bool) {
        self.home = home
        self.fallback = fallback
        self.lang = lang
        self.disabled = disabled
        _text = State(initialValue: home.caseName ?? fallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(L10n.caseDisplayName(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.ink2)
            TextField("", text: $text)
                .textContentType(.givenName)
                .brandText(.body)
                .foregroundStyle(Brand.ink)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .paperSurface(radius: 12, fill: Brand.paper, border: Brand.line2)
                .disabled(disabled)
                .accessibilityLabel(L10n.caseDisplayName(lang))
                .onChange(of: text) { _, value in
                    let capped = HomeModel.capUTF16(value, max: 40)
                    if capped != value { text = capped }
                    if capped != (home.caseName ?? fallback) { home.caseName = capped }
                }
                .onChange(of: home.caseName) { _, value in
                    // A created case clears the name: show the default again.
                    if value == nil { text = fallback }
                }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
