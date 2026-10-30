#if DECLARED_AGE_RANGE
import DeclaredAgeRange
#endif
import UIKit

/// What the phone's own age signal says about the user.
enum PlatformAge: Sendable, Equatable {
    case adult, minor, unknown
}

/// What the app shows over everything else for the age check.
enum AgeGate: Equatable {
    case none
    /// The account hasn't confirmed 18+ yet: the sheet with the checkbox.
    case confirm
    /// Under 18, or the account is blocked: Judge can't be used.
    case blocked
}

/// The age decisions, kept pure so the account and the tests share the rules.
enum AgeCheck {
    static let supportEmail = "support@okjudge.com"
    static let blockedCode = "age_blocked"
    static let unconfirmedCode = "age_unconfirmed"

    /// POST /api/v1/me/age.
    struct Report: Equatable, Sendable {
        var adult: Bool
        var source: String
    }

    /// An age range the platform shared. An upper bound below 18 is a minor;
    /// a lower bound of 18 or more is an adult. No range says nothing.
    static func fromRange(lower: Int?, upper: Int?) -> PlatformAge {
        if let upper, upper < 18 { return .minor }
        if let lower, lower >= 18 { return .adult }
        return .unknown
    }

    /// What to tell the server about this account now, or nil. A minor is
    /// reported even after a confirmation.
    static func report(platform: PlatformAge?, age: AgeStatus?, ticked: Bool) -> Report? {
        guard let age, !age.blocked else { return nil }
        if platform == .minor { return Report(adult: false, source: "platform") }
        if age.confirmed { return nil }
        if platform == .adult { return Report(adult: true, source: "platform") }
        if ticked { return Report(adult: true, source: "checkbox") }
        return nil
    }

    /// The sheet's confirmation: the platform's when it already said 18+.
    static func confirmation(platform: PlatformAge?) -> Report {
        Report(adult: true, source: platform == .adult ? "platform" : "checkbox")
    }

    /// The sheet waits for the platform's answer and for a report in flight,
    /// so it never flashes up.
    static func gate(platform: PlatformAge?, signedIn: Bool, age: AgeStatus?, posting: Bool) -> AgeGate {
        if platform == .minor { return .blocked }
        guard signedIn, let age else { return .none }
        if age.blocked { return .blocked }
        if !age.confirmed, platform != nil, !posting { return .confirm }
        return .none
    }

    /// The sign-in checkbox shows unless the platform already said 18+.
    static func needsCheckbox(platform: PlatformAge?) -> Bool { platform != .adult }

    /// The age error of a 403, sent as `code` or as a bare `error`.
    static func errorCode(status: Int, body: ApiErrorBody?) -> String? {
        guard status == 403 else { return nil }
        return [body?.code, body?.error].compactMap { $0 }.first { $0 == blockedCode || $0 == unconfirmedCode }
    }
}

/// The phone's age signal: Apple's Declared Age Range in the app.
@MainActor
protocol AgeRangeAsking: AnyObject {
    /// Never throws: declined, unsupported or failed reads as `.unknown`.
    func ask() async -> PlatformAge
}

/// Declared Age Range (iOS 26) with one gate at 18. Compiled in only when
/// the build carries the entitlement (DECLARED_AGE_RANGE in
/// Config/Shared.xcconfig); otherwise, and below iOS 26, always unknown.
@MainActor
final class DeclaredAgeRangeAsker: AgeRangeAsking {
    func ask() async -> PlatformAge {
        #if DECLARED_AGE_RANGE
        guard #available(iOS 26.0, *), var controller = PresentationAnchor.current().rootViewController else {
            return .unknown
        }
        // Over the sign-in sheet when it is up.
        while let presented = controller.presentedViewController { controller = presented }
        do {
            switch try await AgeRangeService.shared.requestAgeRange(ageGates: 18, in: controller) {
            case .sharing(let range):
                return AgeCheck.fromRange(lower: range.lowerBound, upper: range.upperBound)
            case .declinedSharing:
                return .unknown
            @unknown default:
                return .unknown
            }
        } catch {
            return .unknown
        }
        #else
        return .unknown
        #endif
    }
}

/// Tests and screenshot states: no platform signal.
@MainActor
final class NoAgeRange: AgeRangeAsking {
    func ask() async -> PlatformAge { .unknown }
}
