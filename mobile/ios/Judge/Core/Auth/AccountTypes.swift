import Foundation

/// Which sign-in methods the server offers right now (GET /api/v1/config →
/// `signIn`, lib/account-types.ts AuthProviders). A missing flag reads as off.
struct SignInProviders: Decodable, Sendable, Equatable {
    var apple = false
    var google = false
    /// Email magic link (website only).
    var email = false
    /// Email one-time code (the apps).
    var emailCode = false
    var dev = false

    init(apple: Bool = false, google: Bool = false, email: Bool = false, emailCode: Bool = false, dev: Bool = false) {
        self.apple = apple
        self.google = google
        self.email = email
        self.emailCode = emailCode
        self.dev = dev
    }

    private enum CodingKeys: String, CodingKey { case apple, google, email, emailCode, dev }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        apple = (try? c.decodeIfPresent(Bool.self, forKey: .apple)) == true
        google = (try? c.decodeIfPresent(Bool.self, forKey: .google)) == true
        email = (try? c.decodeIfPresent(Bool.self, forKey: .email)) == true
        emailCode = (try? c.decodeIfPresent(Bool.self, forKey: .emailCode)) == true
        dev = (try? c.decodeIfPresent(Bool.self, forKey: .dev)) == true
    }

    /// Whether the app can offer any of them (the dev login is web only).
    var any: Bool { apple || google || emailCode }
}

/// GET /api/v1/config, the parts the app reads.
struct ServerConfig: Decodable, Sendable, Equatable {
    var signIn: SignInProviders
    var premiumEnabled: Bool
    /// Prices for the pricing screen; nil when the server sent none.
    var pricing: PricingInfo?
    /// Premium extras this deployment offers (absent on older servers: all off).
    var features: PremiumFeatures

    private enum CodingKeys: String, CodingKey { case signIn, premiumEnabled, pricing, features }

    init(signIn: SignInProviders, premiumEnabled: Bool = false, pricing: PricingInfo? = nil, features: PremiumFeatures = PremiumFeatures()) {
        self.signIn = signIn
        self.premiumEnabled = premiumEnabled
        self.pricing = pricing
        self.features = features
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        signIn = try c.decode(SignInProviders.self, forKey: .signIn)
        premiumEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .premiumEnabled)) == true
        pricing = try? c.decodeIfPresent(PricingInfo.self, forKey: .pricing)
        features = (try? c.decodeIfPresent(PremiumFeatures.self, forKey: .features)) ?? PremiumFeatures()
    }
}

/// `features` of GET /api/v1/config. A missing flag reads as off.
struct PremiumFeatures: Decodable, Sendable, Equatable {
    var cases = false
    var evidence = false

    init(cases: Bool = false, evidence: Bool = false) {
        self.cases = cases
        self.evidence = evidence
    }

    private enum CodingKeys: String, CodingKey { case cases, evidence }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cases = (try? c.decodeIfPresent(Bool.self, forKey: .cases)) == true
        evidence = (try? c.decodeIfPresent(Bool.self, forKey: .evidence)) == true
    }
}

struct PricingPack: Decodable, Sendable, Equatable, Identifiable {
    var id: String
    var credits: Int
    var priceUsd: Double
}

struct PricingPlan: Decodable, Sendable, Equatable {
    var id: String
    var priceUsd: Double
    var fairUseCap: Int
    var periodDays: Int
}

/// `pricing` of GET /api/v1/config (lib/account-types.ts PricingInfo).
struct PricingInfo: Decodable, Sendable, Equatable {
    var currency: String
    /// False until payments exist: buy buttons read "Coming soon".
    var purchasesEnabled: Bool
    var packs: [PricingPack]
    var monthly: PricingPlan

    /// lib/pricing.ts PRICING, shown until the server's config arrives.
    static let fallback = PricingInfo(
        currency: "USD",
        purchasesEnabled: false,
        packs: [
            PricingPack(id: "pack_10", credits: 10, priceUsd: 1.99),
            PricingPack(id: "pack_30", credits: 30, priceUsd: 4.99),
        ],
        monthly: PricingPlan(id: "monthly", priceUsd: 4.99, fairUseCap: 60, periodDays: 30)
    )

    /// "$1.99" in English, "$1,99" in Turkish (formatPrice in lib/pricing.ts).
    static func format(_ usd: Double, lang: AppLang) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: lang == .tr ? "tr_TR" : "en_US")
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: usd)) ?? String(format: "$%.2f", usd)
    }
}

/// The signed-in person (lib/account-types.ts Viewer).
struct Viewer: Decodable, Sendable, Equatable {
    var id: String
    var email: String
    var name: String
    var image: String?

    init(id: String, email: String, name: String = "", image: String? = nil) {
        self.id = id
        self.email = email
        self.name = name
        self.image = image
    }

    private enum CodingKeys: String, CodingKey { case id, email, name, image }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = (try? c.decodeIfPresent(String.self, forKey: .email)) ?? ""
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        image = try? c.decodeIfPresent(String.self, forKey: .image)
    }
}

struct SubscriptionInfo: Decodable, Sendable, Equatable {
    var source: String
    var productId: String
    var periodStart: String
    var periodEnd: String
    var willRenew: Bool
    var used: Int
    var cap: Int
}

/// What the account may do (lib/account-types.ts Entitlement).
struct Entitlement: Decodable, Sendable, Equatable {
    var canUsePremium: Bool
    var blockedReason: String?
    var credits: Int
    var subscription: SubscriptionInfo?
    var resetsAt: String?

    init(canUsePremium: Bool = false, blockedReason: String? = nil, credits: Int = 0, subscription: SubscriptionInfo? = nil, resetsAt: String? = nil) {
        self.canUsePremium = canUsePremium
        self.blockedReason = blockedReason
        self.credits = credits
        self.subscription = subscription
        self.resetsAt = resetsAt
    }

    private enum CodingKeys: String, CodingKey { case canUsePremium, blockedReason, credits, subscription, resetsAt }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        canUsePremium = (try? c.decodeIfPresent(Bool.self, forKey: .canUsePremium)) == true
        blockedReason = try? c.decodeIfPresent(String.self, forKey: .blockedReason)
        if let whole = try? c.decodeIfPresent(Int.self, forKey: .credits) {
            credits = whole
        } else {
            credits = Int((try? c.decodeIfPresent(Double.self, forKey: .credits)) ?? 0)
        }
        subscription = try? c.decodeIfPresent(SubscriptionInfo.self, forKey: .subscription)
        resetsAt = try? c.decodeIfPresent(String.self, forKey: .resetsAt)
    }

    /// Premium while anything premium is held (planOf in AccountView.tsx).
    var isPremium: Bool { credits > 0 || subscription != nil }
}

/// GET /api/v1/me. Signed out (or an unknown token): both nil.
struct AccountInfo: Decodable, Sendable, Equatable {
    var user: Viewer?
    var entitlement: Entitlement?

    init(user: Viewer?, entitlement: Entitlement?) {
        self.user = user
        self.entitlement = entitlement
    }

    private enum CodingKeys: String, CodingKey { case user, entitlement }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        user = try c.decodeIfPresent(Viewer.self, forKey: .user)
        entitlement = try? c.decodeIfPresent(Entitlement.self, forKey: .entitlement)
    }
}

/// A successful sign-in: the bearer token and who it belongs to.
struct AuthSession: Sendable, Equatable {
    let token: String
    let user: Viewer?
}

/// What Sign in with Apple handed over. `rawNonce` is the value whose
/// SHA-256 went into the request; the server checks the token against it.
/// Name and email arrive only on the first sign-in with this app.
struct AppleIdentity: Sendable, Equatable {
    let identityToken: String
    let rawNonce: String
    var firstName: String?
    var lastName: String?
    var email: String?
    /// Apple's one-time authorization code (UTF-8), sent to the server so
    /// the Apple grant can be revoked when the account is deleted.
    var authorizationCode: String?
}

/// What the Google sign-in handed over. Google copies `rawNonce` into the
/// ID token unchanged; the server compares it exactly.
struct GoogleIdentity: Sendable, Equatable {
    let idToken: String
    let rawNonce: String
}

enum SocialProvider: String, Sendable {
    case apple, google
}
