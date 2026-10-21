import SwiftUI

/// Free / Premium beside "Get the verdict" (components/TierSwitch.tsx).
/// While Premium is locked (signed out, or nothing left to spend) choosing
/// it never changes the effective tier: it remembers the intent and reveals
/// the sign-in or pricing link instead.
struct TierSwitchView: View {
    @Environment(AppModel.self) private var app
    let lang: AppLang
    /// While a request is being prepared the choice holds still.
    let disabled: Bool
    let onPricing: () -> Void
    @State private var nudged = false

    var body: some View {
        let availability = app.tierAvailability
        let value = app.effectiveTier
        let locked = availability != .available
        let note = TierLogic.note(
            lang: lang,
            availability: availability,
            value: value,
            entitlement: app.account.entitlement,
            nudged: nudged
        )
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.tierLabel(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                Button(L10n.tierFree(lang)) { pick(.free, locked: locked) }
                    .buttonStyle(ChipButtonStyle(selected: value == .free))
                    .accessibilityAddTraits(value == .free ? .isSelected : [])
                Button {
                    pick(.premium, locked: locked)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "sparkle")
                            .font(.system(size: 12, weight: .semibold))
                            .accessibilityHidden(true)
                        Text(L10n.tierPremium(lang))
                        if locked {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 11, weight: .semibold))
                                .accessibilityHidden(true)
                        }
                    }
                }
                .buttonStyle(ChipButtonStyle(selected: value == .premium))
                .accessibilityAddTraits(value == .premium ? .isSelected : [])
                .accessibilityHint(lockedHint(availability))
            }
            if let note {
                noteView(note)
            }
        }
        .disabled(disabled)
        .opacity(disabled ? 0.6 : 1)
    }

    private func pick(_ tier: Tier, locked: Bool) {
        if tier == .premium, locked {
            nudged = true
            // Premium is already chosen once it can be used.
            app.setTierChoice(.premium)
            return
        }
        app.setTierChoice(tier)
    }

    private func lockedHint(_ availability: TierAvailability) -> String {
        switch availability {
        case .signedOut: return L10n.tierLockedSignIn(lang)
        case .locked: return L10n.tierLockedNoAllowance(lang)
        case .hidden, .available: return ""
        }
    }

    @ViewBuilder
    private func noteView(_ note: TierLogic.Note) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if !note.text.isEmpty {
                Text(note.text)
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let link = note.link, let title = note.linkTitle {
                Button(title) {
                    switch link {
                    case .signIn: app.account.presentSignIn()
                    case .pricing: onPricing()
                    }
                }
                .buttonStyle(LinkButtonStyle())
            }
        }
        .accessibilityElement(children: .contain)
    }
}
