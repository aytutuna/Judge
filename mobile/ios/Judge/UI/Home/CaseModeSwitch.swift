import SwiftUI

/// The mode choice (components/case/CaseModeSwitch.tsx): a verdict
/// right away, or both sides with a private link. The hint says what the
/// chosen mode does.
struct CaseModeSwitch: View {
    let home: HomeModel
    let lang: AppLang
    let disabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.modeLabel(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 6) {
                option(.now, title: L10n.modeNow(lang))
                option(.both, title: L10n.modeBoth(lang))
            }
            Text(home.mode == .both ? L10n.modeBothHint(lang) : L10n.modeNowHint(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1)
    }

    private func option(_ mode: HomeMode, title: String) -> some View {
        let selected = home.mode == mode
        return Button {
            home.mode = mode
        } label: {
            HStack(spacing: 10) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 17))
                    .foregroundStyle(selected ? Brand.terraInk : Brand.muted)
                    .accessibilityHidden(true)
                Text(title)
                    .brandText(.chip)
                    .foregroundStyle(Brand.ink)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(selected ? Brand.terraTint.opacity(0.6) : Brand.ivory2.opacity(0.6)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(selected ? Brand.terra.opacity(0.5) : Brand.line, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

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
