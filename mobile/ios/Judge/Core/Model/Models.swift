import Foundation

// Wire models for /api/v1 (lib/types.ts). Decoding is lenient: unknown enum
// values become `.unknown`, missing arrays become empty, so a newer server
// never breaks an older app. The raw JSON of every `result` is kept next to
// the decoded value (see WireDecoding) so history round-trips unknown fields.

/// An enum that decodes any unrecognised raw value to its `unknown` case.
protocol LenientEnum: RawRepresentable, Decodable, Sendable, Hashable where RawValue == String {
    static var unknown: Self { get }
}

extension LenientEnum {
    init(from decoder: any Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unknown
    }
}

enum FinalVerdict: String, LenientEnum {
    case sideA = "side_a", sideB = "side_b", split, conditional, dissolved
    case tooClose = "too_close"
    case unknown = "_unknown"
}

enum JudgeVerdict: String, LenientEnum {
    case sideA = "side_a", sideB = "side_b", split, conditional, dissolved
    case unknown = "_unknown"
}

enum DisputeType: String, LenientEnum {
    case factual, logical, definitional, values, mixed
    case unknown = "_unknown"
}

enum ClaimKind: String, LenientEnum {
    case fact, value, definition, logic
    case unknown = "_unknown"
}

enum Party: String, LenientEnum {
    case a, b
    case unknown = "_unknown"
}

enum CruxTrialOutcome: String, LenientEnum {
    case survived, overturned, uncertain
    case unknown = "_unknown"
}

enum FactCheckStatus: String, LenientEnum {
    case checked
    case noClaims = "none"
    case unavailable
    case unknown = "_unknown"
}

enum FactStatus: String, LenientEnum {
    case supported, refuted, mixed, unverified
    case unknown = "_unknown"
}

struct Claim: Sendable, Equatable {
    var claim: String
    var kind: ClaimKind
}

struct ArgumentMap: Sendable, Equatable {
    var sideA: [Claim]
    var sideB: [Claim]
    var bedrockA: String
    var bedrockB: String
}

struct SplitPoint: Sendable, Equatable {
    var party: Party
    var point: String
}

struct ConditionalBranch: Sendable, Equatable {
    var ifValue: String
    var then: String
}

struct LeanTally: Sendable, Equatable {
    var forValue: Int
    var against: Int
}

struct Lean: Sendable, Equatable {
    var party: Party
    var unanimous: Bool
    var reason: String
    var tally: LeanTally?
}

/// `lean` has three states on the wire: absent (no lean: winners, refusals,
/// old rows), `null` (the judges split even when forced), or an object.
enum LeanField: Sendable, Equatable {
    case absent
    case tie
    case lean(Lean)

    var value: Lean? {
        if case .lean(let lean) = self { return lean }
        return nil
    }
}

struct CruxTrial: Sendable, Equatable {
    var attack: String
    var outcome: CruxTrialOutcome
    var reasoning: String
}

struct FactSource: Sendable, Equatable {
    var title: String
    var url: String
}

struct FactClaim: Sendable, Equatable {
    var claim: String
    var status: FactStatus
    var summary: String
    var sources: [FactSource]
}

struct FactCheck: Sendable, Equatable {
    var status: FactCheckStatus
    var claims: [FactClaim]
}

struct Panel: Sendable, Equatable {
    var models: [String]
}

struct VerdictResult: Sendable, Equatable {
    var verdict: FinalVerdict
    var disputeType: DisputeType
    var headline: String
    var crux: String
    var splitPoints: [SplitPoint]?
    var conditional: [ConditionalBranch]?
    var argumentMap: ArgumentMap
    var factsReliedOn: [String]
    var losingSideBestPoint: String
    var confidence: Int
    var runs: [JudgeVerdict]
    var demo: Bool
    var modelRefused: Bool
    var cruxTrial: CruxTrial?
    var lean: LeanField
    var escalated: Bool
    /// Language the free text is written in; nil on rows stored before it existed.
    var lang: AppLang?
    var tier: String?
    var factCheck: FactCheck?
    var panel: Panel?

    var isPremium: Bool { tier == "premium" }
}

struct NameMapping: Codable, Sendable, Equatable, Hashable {
    var original: String
    var replacement: String
}

struct ApiErrorBody: Decodable, Sendable, Equatable {
    var error: String?
    var code: String?
    var retryAfterSec: Double?
    var resetsAt: String?

    init(error: String? = nil, code: String? = nil, retryAfterSec: Double? = nil, resetsAt: String? = nil) {
        self.error = error
        self.code = code
        self.retryAfterSec = retryAfterSec
        self.resetsAt = resetsAt
    }

    private enum CodingKeys: String, CodingKey { case error, code, retryAfterSec, resetsAt }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        error = try? c.decodeIfPresent(String.self, forKey: .error)
        code = try? c.decodeIfPresent(String.self, forKey: .code)
        retryAfterSec = try? c.decodeIfPresent(Double.self, forKey: .retryAfterSec)
        resetsAt = try? c.decodeIfPresent(String.self, forKey: .resetsAt)
    }
}

/// POST /api/v1/verdict body. `sliders` and `clarifications` exist for
/// later phases and are omitted from the JSON while nil.
struct VerdictRequest: Encodable, Sendable, Equatable {
    struct Framework: Encodable, Sendable, Equatable {
        var preset: String
        var sliders: [String: Int]?
    }

    struct Clarification: Encodable, Sendable, Equatable {
        var question: String
        var answer: String
    }

    var argument: String
    var framework: Framework
    var lang: AppLang
    var tier: String = "free"
    var clarifications: [Clarification]?
    var turnstileToken: String?
}

// MARK: - Decoding

extension Claim: Decodable {
    private enum CodingKeys: String, CodingKey { case claim, kind }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        claim = try c.decodeIfPresent(String.self, forKey: .claim) ?? ""
        kind = (try? c.decodeIfPresent(ClaimKind.self, forKey: .kind)) ?? .unknown
    }
}

extension ArgumentMap: Decodable {
    private enum CodingKeys: String, CodingKey {
        case sideA = "side_a", sideB = "side_b", bedrockA = "bedrock_a", bedrockB = "bedrock_b"
    }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sideA = try c.decodeIfPresent([Claim].self, forKey: .sideA) ?? []
        sideB = try c.decodeIfPresent([Claim].self, forKey: .sideB) ?? []
        bedrockA = try c.decodeIfPresent(String.self, forKey: .bedrockA) ?? ""
        bedrockB = try c.decodeIfPresent(String.self, forKey: .bedrockB) ?? ""
    }

    static let empty = ArgumentMap(sideA: [], sideB: [], bedrockA: "", bedrockB: "")
}

extension SplitPoint: Decodable {
    private enum CodingKeys: String, CodingKey { case party, point }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        party = (try? c.decodeIfPresent(Party.self, forKey: .party)) ?? .unknown
        point = try c.decodeIfPresent(String.self, forKey: .point) ?? ""
    }
}

extension ConditionalBranch: Decodable {
    private enum CodingKeys: String, CodingKey { case ifValue = "if_value", then }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ifValue = try c.decodeIfPresent(String.self, forKey: .ifValue) ?? ""
        then = try c.decodeIfPresent(String.self, forKey: .then) ?? ""
    }
}

extension LeanTally: Decodable {
    private enum CodingKeys: String, CodingKey { case forValue = "for", against }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        forValue = try c.decode(Int.self, forKey: .forValue)
        against = try c.decode(Int.self, forKey: .against)
    }
}

extension Lean: Decodable {
    private enum CodingKeys: String, CodingKey { case party, unanimous, reason, tally }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        party = (try? c.decodeIfPresent(Party.self, forKey: .party)) ?? .unknown
        unanimous = try c.decodeIfPresent(Bool.self, forKey: .unanimous) ?? false
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        tally = try? c.decodeIfPresent(LeanTally.self, forKey: .tally)
    }
}

extension CruxTrial: Decodable {
    private enum CodingKeys: String, CodingKey { case attack, outcome, reasoning }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        attack = try c.decodeIfPresent(String.self, forKey: .attack) ?? ""
        outcome = (try? c.decodeIfPresent(CruxTrialOutcome.self, forKey: .outcome)) ?? .unknown
        reasoning = try c.decodeIfPresent(String.self, forKey: .reasoning) ?? ""
    }
}

extension FactSource: Decodable {
    private enum CodingKeys: String, CodingKey { case title, url }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
    }
}

extension FactClaim: Decodable {
    private enum CodingKeys: String, CodingKey { case claim, status, summary, sources }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        claim = try c.decodeIfPresent(String.self, forKey: .claim) ?? ""
        status = (try? c.decodeIfPresent(FactStatus.self, forKey: .status)) ?? .unknown
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        sources = try c.decodeIfPresent([FactSource].self, forKey: .sources) ?? []
    }
}

extension FactCheck: Decodable {
    private enum CodingKeys: String, CodingKey { case status, claims }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = (try? c.decodeIfPresent(FactCheckStatus.self, forKey: .status)) ?? .unknown
        claims = try c.decodeIfPresent([FactClaim].self, forKey: .claims) ?? []
    }
}

extension Panel: Decodable {
    private enum CodingKeys: String, CodingKey { case models }
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        models = try c.decodeIfPresent([String].self, forKey: .models) ?? []
    }
}

extension VerdictResult: Decodable {
    private enum CodingKeys: String, CodingKey {
        case verdict, headline, crux, conditional, confidence, runs, demo, lean, escalated, lang, tier, panel
        case disputeType = "dispute_type"
        case splitPoints = "split_points"
        case argumentMap = "argument_map"
        case factsReliedOn = "facts_relied_on"
        case losingSideBestPoint = "losing_side_best_point"
        case modelRefused = "model_refused"
        case cruxTrial = "crux_trial"
        case factCheck = "fact_check"
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        verdict = (try? c.decodeIfPresent(FinalVerdict.self, forKey: .verdict)) ?? .unknown
        disputeType = (try? c.decodeIfPresent(DisputeType.self, forKey: .disputeType)) ?? .unknown
        headline = try c.decodeIfPresent(String.self, forKey: .headline) ?? ""
        crux = try c.decodeIfPresent(String.self, forKey: .crux) ?? ""
        splitPoints = try? c.decodeIfPresent([SplitPoint].self, forKey: .splitPoints)
        conditional = try? c.decodeIfPresent([ConditionalBranch].self, forKey: .conditional)
        argumentMap = (try? c.decodeIfPresent(ArgumentMap.self, forKey: .argumentMap)) ?? .empty
        factsReliedOn = (try? c.decodeIfPresent([String].self, forKey: .factsReliedOn)) ?? []
        losingSideBestPoint = try c.decodeIfPresent(String.self, forKey: .losingSideBestPoint) ?? ""
        if let whole = try? c.decodeIfPresent(Int.self, forKey: .confidence) {
            confidence = whole
        } else if let fraction = try? c.decodeIfPresent(Double.self, forKey: .confidence), fraction.isFinite {
            confidence = Int(fraction.rounded())
        } else {
            confidence = 1
        }
        runs = (try? c.decodeIfPresent([JudgeVerdict].self, forKey: .runs)) ?? []
        demo = (try? c.decodeIfPresent(Bool.self, forKey: .demo)) ?? false
        modelRefused = (try? c.decodeIfPresent(Bool.self, forKey: .modelRefused)) ?? false
        cruxTrial = try? c.decodeIfPresent(CruxTrial.self, forKey: .cruxTrial)
        if !c.contains(.lean) {
            lean = .absent
        } else if (try? c.decodeNil(forKey: .lean)) == true {
            lean = .tie
        } else if let value = try? c.decode(Lean.self, forKey: .lean) {
            lean = .lean(value)
        } else {
            lean = .absent
        }
        escalated = (try? c.decodeIfPresent(Bool.self, forKey: .escalated)) ?? false
        let langRaw: String? = try? c.decodeIfPresent(String.self, forKey: .lang)
        lang = langRaw.flatMap(AppLang.init(rawValue:))
        tier = try? c.decodeIfPresent(String.self, forKey: .tier)
        factCheck = try? c.decodeIfPresent(FactCheck.self, forKey: .factCheck)
        panel = try? c.decodeIfPresent(Panel.self, forKey: .panel)
    }
}
