import Foundation

/// Free or Premium, as the user picked it on Home.
enum Tier: String, Sendable, CaseIterable {
    case free, premium
}

/// What the viewer may pick (lib/tier.ts TierAvailability).
/// - hidden: premium is off here (or the config has not loaded), or the
///   viewer is signed out and no sign-in method is offered: no switch.
/// - signedOut: switch shown, Premium locked behind sign-in.
/// - locked: signed in, but nothing to spend right now.
/// - available: both options selectable.
enum TierAvailability: Sendable, Equatable {
    case hidden, signedOut, locked, available
}

/// Port of lib/tier.ts and the note of components/TierSwitch.tsx.
enum TierLogic {
    static func availability(config: ServerConfig?, signedIn: Bool, entitlement: Entitlement?) -> TierAvailability {
        guard let config, config.premiumEnabled else { return .hidden }
        guard signedIn else { return config.signIn.any ? .signedOut : .hidden }
        return entitlement?.canUsePremium == true ? .available : .locked
    }

    /// A remembered "premium" only counts while premium can be used, so a
    /// stale choice never sends a premium request.
    static func effective(_ availability: TierAvailability, choice: Tier) -> Tier {
        availability == .available && choice == .premium ? .premium : .free
    }

    /// What is left to spend: the subscription's allowance first (it funds a
    /// verdict before credits do), then credit packs.
    enum Remaining: Sendable, Equatable {
        case monthly(Int)
        case credits(Int)
    }

    static func remaining(_ entitlement: Entitlement?) -> Remaining? {
        guard let entitlement else { return nil }
        if let sub = entitlement.subscription, sub.cap - sub.used > 0 { return .monthly(sub.cap - sub.used) }
        if entitlement.credits > 0 { return .credits(entitlement.credits) }
        return nil
    }

    /// Where the note's link goes.
    enum Link: Sendable, Equatable {
        case signIn, pricing
    }

    /// The line under the switch: text, then an optional link.
    struct Note: Sendable, Equatable {
        let text: String
        let link: Link?
        let linkTitle: String?
    }

    /// `nudged` turns true once a signed-out viewer reached for the locked
    /// Premium option; only then the sign-in link shows (as on the web).
    static func note(
        lang: AppLang,
        availability: TierAvailability,
        value: Tier,
        entitlement: Entitlement?,
        nudged: Bool
    ) -> Note? {
        switch availability {
        case .hidden:
            return nil
        case .signedOut:
            return nudged ? Note(text: "", link: .signIn, linkTitle: L10n.tierSignInToUse(lang)) : nil
        case .locked:
            // Signed in but /me has not answered yet: nothing to say.
            guard let entitlement else { return nil }
            let title = L10n.tierGetPremium(lang)
            switch entitlement.blockedReason {
            case "fair_use":
                let text = ErrorText.formatDate(entitlement.resetsAt, lang: lang).map { L10n.tierFairUse(lang, date: $0) }
                    ?? L10n.tierFairUseSoon(lang)
                return Note(text: text, link: .pricing, linkTitle: title)
            case "no_credits":
                return Note(text: L10n.tierOutOfCredits(lang), link: .pricing, linkTitle: title)
            default:
                return Note(text: L10n.tierInvite(lang), link: .pricing, linkTitle: title)
            }
        case .available:
            if value == .free { return Note(text: L10n.tierFreeHint(lang), link: nil, linkTitle: nil) }
            var parts = [L10n.tierPremiumHint(lang)]
            switch remaining(entitlement) {
            case .monthly(let n): parts.append(L10n.tierMonthlyLeft(lang, n: String(n)))
            case .credits(let n): parts.append(L10n.tierCreditsLeft(lang, n: n))
            case nil: break
            }
            return Note(text: parts.joined(separator: " "), link: nil, linkTitle: nil)
        }
    }
}
