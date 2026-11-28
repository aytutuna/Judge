#if DECLARED_AGE_RANGE
import DeclaredAgeRange
#endif
import StoreKit
import UIKit

/// What the phone's own age signal says about the user.
enum PlatformAge: Sendable, Equatable {
    case adult, minor, under13, unknown
}

/// What the app shows over everything else for the age check.
enum AgeGate: Equatable {
    case none
    /// The account has no date of birth yet.
    case date
    /// Closed for age for good: Judge can't be used.
    case blocked
    /// Brazil under 18: closed until the 18th birthday.
    case restricted
    /// A parent has to say yes (or said no, or took it back).
    case parent
}

/// The age decisions, kept pure so the account and the tests share the rules.
enum AgeCheck {
    static let supportEmail = "support@okjudge.com"
    static let blockedCode = "age_blocked"
    static let unconfirmedCode = "age_unconfirmed"
    static let setCode = "age_set"
    static let regionCode = "age_region"
    static let parentPendingCode = "age_parent_pending"
    /// The 403s that put an age screen over the app.
    static let gateCodes: Set = [blockedCode, unconfirmedCode, regionCode, parentPendingCode]
    static let earliestDob = "1900-01-01"

    /// POST /api/v1/me/age with the phone's answer.
    struct Report: Equatable, Sendable {
        var adult: Bool
        var under13 = false
    }

    /// An age range the platform shared. An upper bound below 13 is under 13,
    /// below 18 a minor; a lower bound of 18 or more is an adult. A range
    /// across 18, or no range, says nothing.
    static func fromRange(lower: Int?, upper: Int?) -> PlatformAge {
        if let upper, upper < 13 { return .under13 }
        if let upper, upper < 18 { return .minor }
        if let lower, lower >= 18 { return .adult }
        return .unknown
    }

    /// What to tell the server about this account now, or nil. Sent on every
    /// launch, since only a later "adult" can clear an earlier "minor".
    static func report(platform: PlatformAge?, age: AgeStatus?) -> Report? {
        guard let age, !(age.blocked && !age.needsDob) else { return nil }
        switch platform {
        case .adult: return Report(adult: true)
        case .minor: return Report(adult: false)
        case .under13: return Report(adult: false, under13: true)
        case .unknown, nil: return nil
        }
    }

    /// What the phone's answer comes to: the derived age and whether the law
    /// asks a parent to consent to significant changes for this person.
    struct StoreAnswer: Sendable, Equatable {
        var age: PlatformAge
        var parentalConsentRequired = false
    }

    /// The phone's whole answer reduced to what the app acts on. The range
    /// itself goes no further than this: only the derived age is sent to the
    /// server. Consent is asked only for a minor, and only where the system
    /// lists it among the required regulatory features.
    static func fromStore(lower: Int?, upper: Int?, parentalConsentFeature: Bool) -> StoreAnswer {
        let age = fromRange(lower: lower, upper: upper)
        return StoreAnswer(age: age, parentalConsentRequired: parentalConsentFeature && age == .minor)
    }

    /// What the server's age state asks the app to show.
    static func gate(signedIn: Bool, age: AgeStatus?) -> AgeGate {
        guard signedIn, let age else { return .none }
        if age.blocked && !age.needsDob { return .blocked }
        if age.restricted { return .restricted }
        if age.parent != nil { return .parent }
        return age.needsDob ? .date : .none
    }

    /// The age error of a 403, sent as `code` or as a bare `error`.
    static func errorCode(status: Int, body: ApiErrorBody?) -> String? {
        guard status == 403 else { return nil }
        return [body?.code, body?.error].compactMap { $0 }.first { gateCodes.contains($0) }
    }

    // MARK: - Dates

    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    /// The server's dates are Gregorian whatever calendar the phone shows
    /// (Buddhist in Thailand, Persian in Iran), in the phone's time zone.
    static var gregorian: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }

    /// A calendar date as `YYYY-MM-DD`.
    static func dobString(year: Int, month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }

    /// The picked day as the plain date the server takes, in the calendar the
    /// picker showed it in.
    static func dobString(from date: Date, calendar: Calendar) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return dobString(year: parts.year ?? 1900, month: parts.month ?? 1, day: parts.day ?? 1)
    }

    /// Today anywhere on Earth: the date in UTC+14.
    static func latestDob(now: Date) -> String {
        let parts = utc.dateComponents([.year, .month, .day], from: now.addingTimeInterval(14 * 3600))
        return dobString(year: parts.year!, month: parts.month!, day: parts.day!)
    }

    /// The date `years` before `now` in UTC; 29 February becomes the 28th.
    static func yearsBefore(_ now: Date, years: Int) -> String {
        let parts = utc.dateComponents([.year, .month, .day], from: now)
        let leapDay = parts.month == 2 && parts.day == 29
        return dobString(year: parts.year! - years, month: parts.month!, day: leapDay ? 28 : parts.day!)
    }

    /// Under 13 on the latest date anywhere on Earth, so nobody is closed out
    /// on a birthday in their own time zone (same rule as the website).
    static func underThirteen(dob: String, now: Date = Date()) -> Bool {
        dob > yearsBefore(now.addingTimeInterval(14 * 3600), years: 13)
    }

    /// Younger than `years` full years on `now`'s date.
    static func youngerThan(_ dob: String, years: Int, now: Date = Date()) -> Bool {
        dob > yearsBefore(now, years: years)
    }

    /// The date step asks where a 13 to 15 year old lives.
    static func asksCountry(dob: String, now: Date = Date()) -> Bool {
        !underThirteen(dob: dob, now: now) && youngerThan(dob, years: 16, now: now)
    }

    /// And, for a 13 year old in Canada, whether in Quebec.
    static func asksQuebec(dob: String, country: String?, now: Date = Date()) -> Bool {
        asksCountry(dob: dob, now: now) && youngerThan(dob, years: 14, now: now) && country == "CA"
    }

    /// What the picker starts on.
    static func defaultDobDate(now: Date = Date(), calendar: Calendar = gregorian) -> Date {
        calendar.date(byAdding: .year, value: -18, to: now) ?? now
    }

    /// What the picker takes: 1900-01-01 to today in UTC+14, read as days in
    /// the Gregorian calendar.
    static func dobRange(now: Date = Date(), calendar: Calendar = gregorian) -> ClosedRange<Date> {
        func day(_ dob: String, hour: Int, minute: Int = 0, second: Int = 0) -> Date? {
            let parts = dob.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return nil }
            return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: hour, minute: minute, second: second))
        }
        let first = day(earliestDob, hour: 0) ?? .distantPast
        let last = day(latestDob(now: now), hour: 23, minute: 59, second: 59) ?? now
        return first...max(first, last)
    }

    /// The date written out for the confirm step, in the app's language.
    static func longDate(_ dob: String, lang: AppLang) -> String {
        let parts = dob.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return dob }
        var calendar = utc
        calendar.locale = lang.locale
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) else { return dob }
        let formatter = DateFormatter()
        formatter.locale = lang.locale
        formatter.calendar = calendar
        formatter.timeZone = utc.timeZone
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

enum StoreCountry {
    /// The App Store country as the two letters the server takes; StoreKit
    /// names it with three. nil when the store doesn't say.
    static func current() async -> String? {
        guard let code = await Storefront.current?.countryCode else { return nil }
        return Countries.alpha2(fromAlpha3: code)
    }
}

/// The phone's age signal: Apple's Declared Age Range in the app.
@MainActor
protocol AgeRangeAsking: AnyObject {
    /// Never throws: declined, unsupported or failed reads as `.unknown`.
    func ask() async -> PlatformAge
    /// Set by the last `ask()`: a parent must consent to significant changes.
    var needsParentalConsent: Bool { get }
}

extension AgeRangeAsking {
    var needsParentalConsent: Bool { false }
}

/// Declared Age Range (iOS 26) with gates at 13 and 18, which is what lets
/// it tell under 13 from 13 to 17. Compiled in only when
/// the build carries the entitlement (DECLARED_AGE_RANGE in
/// Config/Shared.xcconfig); otherwise, and below iOS 26, always unknown.
@MainActor
final class DeclaredAgeRangeAsker: AgeRangeAsking {
    private(set) var needsParentalConsent = false

    func ask() async -> PlatformAge {
        needsParentalConsent = false
        #if DECLARED_AGE_RANGE
        // Below the age window, which would take the sheet down with it.
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let below = scenes.flatMap(\.windows).filter { !$0.isHidden && $0.windowLevel < .alert + 1 }
        guard #available(iOS 26.0, *),
              var controller = (below.first(where: \.isKeyWindow) ?? below.first)?.rootViewController
        else { return .unknown }
        // Over the sign-in sheet when it is up.
        while let presented = controller.presentedViewController { controller = presented }
        do {
            switch try await AgeRangeService.shared.requestAgeRange(ageGates: 13, 18, in: controller) {
            case .sharing(let range):
                let answer = AgeCheck.fromStore(
                    lower: range.lowerBound, upper: range.upperBound,
                    parentalConsentFeature: await Self.parentalConsentRequired()
                )
                needsParentalConsent = answer.parentalConsentRequired
                return answer.age
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

    #if DECLARED_AGE_RANGE
    /// Whether the system lists parental consent for significant changes
    /// among this person's regulatory features (iOS 26.4).
    private nonisolated static func parentalConsentRequired() async -> Bool {
        guard #available(iOS 26.4, *) else { return false }
        let features = (try? await AgeRangeService.shared.requiredRegulatoryFeatures) ?? []
        return features.contains(.significantAppChangeRequiresParentalConsent)
    }
    #endif
}

/// Tests and screenshot states: no platform signal.
@MainActor
final class NoAgeRange: AgeRangeAsking {
    func ask() async -> PlatformAge { .unknown }
}
