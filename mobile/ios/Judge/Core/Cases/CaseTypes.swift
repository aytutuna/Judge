import Foundation

// Two-sided cases (lib/case-types.ts), as the case owner sees them. Decoding
// is lenient like the verdict models: unknown values become `.unknown`.

enum CaseStatus: String, LenientEnum {
    case awaitingRespondent = "awaiting_respondent"
    case judging, judged, failed, expired
    case unknown = "_unknown"
}

enum CaseMode: String, LenientEnum {
    case twoSided = "two_sided"
    case oneSided = "one_sided"
    case unknown = "_unknown"
}

enum CaseRole: String, LenientEnum {
    case owner, respondent
    case unknown = "_unknown"
}

enum InviteStatus: String, LenientEnum {
    case waiting, answered, closed
    case unknown = "_unknown"
}

enum CaseAppealStatus: String, LenientEnum {
    case judging, judged, failed
    case unknown = "_unknown"
}

struct CaseEvidence: Decodable, Sendable, Equatable {
    var id: String
    var kind: String
    var transcript: String

    private enum CodingKeys: String, CodingKey { case id, kind, transcript }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ""
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? "other"
        transcript = (try? c.decodeIfPresent(String.self, forKey: .transcript)) ?? ""
    }
}

/// One party's account, anonymized as the judges read it.
struct CaseSide: Decodable, Sendable, Equatable {
    var party: Party
    var text: String
    var evidence: [CaseEvidence]
    var submittedAt: String
    /// That party removed their side: text and evidence are left out.
    var removed: Bool

    private enum CodingKeys: String, CodingKey { case party, text, evidence, submittedAt, removed }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        party = (try? c.decodeIfPresent(Party.self, forKey: .party)) ?? .unknown
        text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? ""
        evidence = (try? c.decodeIfPresent([CaseEvidence].self, forKey: .evidence)) ?? []
        submittedAt = (try? c.decodeIfPresent(String.self, forKey: .submittedAt)) ?? ""
        removed = (try? c.decodeIfPresent(Bool.self, forKey: .removed)) == true
    }
}

/// Context one party added after a verdict.
struct CaseAppeal: Decodable, Sendable, Equatable {
    var id: String
    var party: Party
    var status: CaseAppealStatus
    /// "quota" | "unavailable" | "refused" when it failed.
    var error: String?
    var text: String
    var evidence: [CaseEvidence]
    var outcome: AppealOutcome?
    var verdictId: String?
    var createdAt: String
    var removed: Bool

    private enum CodingKeys: String, CodingKey { case id, party, status, error, text, evidence, outcome, verdictId, createdAt, removed }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ""
        party = (try? c.decodeIfPresent(Party.self, forKey: .party)) ?? .unknown
        status = (try? c.decodeIfPresent(CaseAppealStatus.self, forKey: .status)) ?? .unknown
        error = try? c.decodeIfPresent(String.self, forKey: .error)
        text = (try? c.decodeIfPresent(String.self, forKey: .text)) ?? ""
        evidence = (try? c.decodeIfPresent([CaseEvidence].self, forKey: .evidence)) ?? []
        outcome = try? c.decodeIfPresent(AppealOutcome.self, forKey: .outcome)
        verdictId = try? c.decodeIfPresent(String.self, forKey: .verdictId)
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? ""
        removed = (try? c.decodeIfPresent(Bool.self, forKey: .removed)) == true
    }
}

/// One verdict of a case, oldest first; the last one is current. `id` is the
/// verdict's share id (/v/<id>, translate endpoint).
struct CaseVerdict: Sendable, Equatable {
    var seq: Int
    var id: String
    var result: RawResult
    var appealId: String?
    var createdAt: String
}

/// Whether the viewer can add context, and why not (lib/case-types.ts AppealBlock).
struct CaseAppealGate: Decodable, Sendable, Equatable {
    var allowed: Bool
    var blockedBy: String?

    init(allowed: Bool = false, blockedBy: String? = nil) {
        self.allowed = allowed
        self.blockedBy = blockedBy
    }

    private enum CodingKeys: String, CodingKey { case allowed, blockedBy }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        allowed = (try? c.decodeIfPresent(Bool.self, forKey: .allowed)) == true
        blockedBy = try? c.decodeIfPresent(String.self, forKey: .blockedBy)
    }
}

/// Context the writer added to a one-sided verdict (VerdictAppealView in
/// lib/types.ts). Its id is also the id of the verdict it produces.
struct VerdictAppealRound: Decodable, Sendable, Equatable {
    var id: String
    var status: CaseAppealStatus
    /// "quota" | "unavailable" | "refused" when it failed.
    var error: String?
    var outcome: AppealOutcome?
    /// The verdict it answered: the first one, or the previous round's.
    var baseId: String

    private enum CodingKeys: String, CodingKey { case id, status, error, outcome, baseId }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(String.self, forKey: .id)) ?? ""
        status = (try? c.decodeIfPresent(CaseAppealStatus.self, forKey: .status)) ?? .unknown
        error = try? c.decodeIfPresent(String.self, forKey: .error)
        outcome = try? c.decodeIfPresent(AppealOutcome.self, forKey: .outcome)
        baseId = (try? c.decodeIfPresent(String.self, forKey: .baseId)) ?? ""
    }
}

/// A one-sided verdict's rounds of added context from GET
/// /api/v1/verdicts/{id}, oldest first, and the writer's `owner.appeal`
/// (nil for everyone else).
struct VerdictRounds: Sendable, Equatable {
    var appeals: [VerdictAppealRound]
    var gate: CaseAppealGate?
}

/// 202 from POST /api/v1/verdicts/{id}/appeals: the rounds now, and the new
/// round as an accepted verdict (it is polled the same way).
struct VerdictAppealSubmission: Sendable, Equatable {
    var appeal: VerdictAppealRound
    var appeals: [VerdictAppealRound]
    var accepted: VerdictAccepted
}

/// One invited side of a case with more than two sides, as its owner sees it
/// (CaseInviteView in lib/case-types.ts): B to D, each with its own link.
struct CaseInvite: Decodable, Sendable, Equatable {
    var party: Party
    var status: InviteStatus
    /// The owner's link while the side waits; nil once answered or closed.
    var inviteUrl: String?
    var answeredAt: String?

    private enum CodingKeys: String, CodingKey { case party, status, inviteUrl, answeredAt }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        party = (try? c.decodeIfPresent(Party.self, forKey: .party)) ?? .unknown
        status = (try? c.decodeIfPresent(InviteStatus.self, forKey: .status)) ?? .unknown
        inviteUrl = try? c.decodeIfPresent(String.self, forKey: .inviteUrl)
        answeredAt = try? c.decodeIfPresent(String.self, forKey: .answeredAt)
    }
}

/// The names each party chose for the share pages, and the owner's switch.
/// C and D only come with more than two sides.
struct CaseDisplay: Decodable, Sendable, Equatable {
    var namesVisible: Bool
    var a: String?
    var b: String?
    var c: String?
    var d: String?

    init(namesVisible: Bool = true, a: String? = nil, b: String? = nil, c: String? = nil, d: String? = nil) {
        self.namesVisible = namesVisible
        self.a = a
        self.b = b
        self.c = c
        self.d = d
    }

    private enum CodingKeys: String, CodingKey { case namesVisible, a, b, c, d }

    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        namesVisible = (try? container.decodeIfPresent(Bool.self, forKey: .namesVisible)) ?? true
        a = try? container.decodeIfPresent(String.self, forKey: .a)
        b = try? container.decodeIfPresent(String.self, forKey: .b)
        c = try? container.decodeIfPresent(String.self, forKey: .c)
        d = try? container.decodeIfPresent(String.self, forKey: .d)
    }

    func name(_ party: Party) -> String? {
        switch party {
        case .a: return a
        case .b: return b
        case .c: return c
        case .d: return d
        case .unknown: return nil
        }
    }
}

struct CaseRemoval: Decodable, Sendable, Equatable {
    var at: String
    var parties: [Party]

    private enum CodingKeys: String, CodingKey { case at, parties }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = (try? c.decodeIfPresent(String.self, forKey: .at)) ?? ""
        parties = (try? c.decodeIfPresent([Party].self, forKey: .parties)) ?? []
    }
}

/// What one party may see of a case (lib/case-types.ts CaseView).
struct CaseView: Sendable, Equatable {
    var id: String
    var role: CaseRole
    var yourParty: Party
    var status: CaseStatus
    var mode: CaseMode?
    /// Only a premium case holds a unit and takes evidence.
    var tier: Tier
    var lang: AppLang?
    var createdAt: String
    var expiresAt: String
    var judgedAt: String?
    var respondentAnswered: Bool
    /// Side A is not written yet: the link was sent first.
    var ownerSideMissing = false
    /// Owner only, while awaiting the respondent.
    var inviteUrl: String?
    var sides: [CaseSide]
    var verdicts: [CaseVerdict]
    var appeals: [CaseAppeal]
    var canJudgeNow: Bool
    var appeal: CaseAppealGate
    var lastError: String?
    /// Poll again after this many ms while something is judging; nil otherwise.
    var pollAfterMs: Double?
    /// The viewer's own name map, from the server's encrypted copy.
    var names: [NameMapping]?
    var display: CaseDisplay
    /// Set once a party removed their side: every link of the case is closed.
    var removed: CaseRemoval?
    var yourOriginal: String
    /// Only with three or four sides: A to C or A to D.
    var parties: [Party]? = nil
    /// Only with three or four sides, for the owner: sides B to D, each with
    /// its own link. `inviteUrl` stays side B's.
    var invites: [CaseInvite]? = nil
    /// Only with three or four sides, for the owner: the answers in so far
    /// are enough to judge without the rest.
    var canJudgeAnswered = false
    /// The place the court is drawn in, set when the case was made; nil is the court.
    var venue: String? = nil

    var isMany: Bool { parties != nil }
    var sideCount: Int { parties?.count ?? 2 }
    var current: CaseVerdict? { verdicts.last }
    var appealJudging: Bool { appeals.contains { $0.status == .judging } }
}

/// GET /api/v1/cases list entry (lib/case-types.ts CaseSummary).
struct CaseSummary: Decodable, Sendable, Equatable, Identifiable {
    var id: String
    var status: CaseStatus
    var mode: CaseMode?
    var createdAt: String
    var expiresAt: String
    var respondentAnswered: Bool
    var verdict: FinalVerdict?
    var headline: String?
    var excerpt: String?
    var removed: Bool
    /// Only with three or four sides.
    var parties: [Party]?
    var venue: String?

    private enum CodingKeys: String, CodingKey {
        case id, status, mode, createdAt, expiresAt, respondentAnswered, verdict, headline, excerpt, removed, parties, venue
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        status = (try? c.decodeIfPresent(CaseStatus.self, forKey: .status)) ?? .unknown
        mode = try? c.decodeIfPresent(CaseMode.self, forKey: .mode)
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? ""
        expiresAt = (try? c.decodeIfPresent(String.self, forKey: .expiresAt)) ?? ""
        respondentAnswered = (try? c.decodeIfPresent(Bool.self, forKey: .respondentAnswered)) == true
        verdict = try? c.decodeIfPresent(FinalVerdict.self, forKey: .verdict)
        headline = try? c.decodeIfPresent(String.self, forKey: .headline)
        excerpt = try? c.decodeIfPresent(String.self, forKey: .excerpt)
        removed = (try? c.decodeIfPresent(Bool.self, forKey: .removed)) == true
        parties = manyParties(try? c.decodeIfPresent([Party].self, forKey: .parties))
        venue = try? c.decodeIfPresent(String.self, forKey: .venue)
    }

    var sideCount: Int { parties?.count ?? 2 }
}

/// The sides of a case with more than two; a list with two known sides or
/// fewer is left out, so the case reads as a two-sided one.
private func manyParties(_ listed: [Party]?) -> [Party]? {
    let known = listed?.filter { $0 != .unknown }
    return known.flatMap { $0.count > 2 ? $0 : nil }
}

/// POST /api/v1/cases, .../side and .../appeals: the case view,
/// the names taken out of what was just sent, and the new balance.
struct CaseSubmission: Sendable, Equatable {
    var view: CaseView
    var nameMap: [NameMapping]
    var entitlement: Entitlement?
}

/// Everything in a CaseView except the verdicts, whose raw JSON is kept
/// (see CaseDecoding).
private struct CaseViewWire: Decodable {
    var id: String
    var role: CaseRole
    var yourParty: Party
    var status: CaseStatus
    var mode: CaseMode?
    var tier: Tier
    var lang: AppLang?
    var createdAt: String
    var expiresAt: String
    var judgedAt: String?
    var respondentAnswered: Bool
    var ownerSideMissing: Bool
    var inviteUrl: String?
    var sides: [CaseSide]
    var appeals: [CaseAppeal]
    var canJudgeNow: Bool
    var appeal: CaseAppealGate
    var lastError: String?
    var pollAfterMs: Double?
    var names: [NameMapping]?
    var display: CaseDisplay
    var removed: CaseRemoval?
    var yourOriginal: String
    var parties: [Party]?
    var invites: [CaseInvite]?
    var canJudgeAnswered: Bool
    var venue: String?

    private enum CodingKeys: String, CodingKey {
        case id, role, yourParty, status, mode, tier, lang, createdAt, expiresAt, judgedAt, respondentAnswered
        case ownerSideMissing, inviteUrl, sides, appeals, canJudgeNow, appeal, lastError, pollAfterMs, names, display, removed, yourOriginal
        case parties, invites, canJudgeAnswered, venue
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        role = (try? c.decodeIfPresent(CaseRole.self, forKey: .role)) ?? .unknown
        yourParty = (try? c.decodeIfPresent(Party.self, forKey: .yourParty)) ?? .a
        status = (try? c.decodeIfPresent(CaseStatus.self, forKey: .status)) ?? .unknown
        mode = try? c.decodeIfPresent(CaseMode.self, forKey: .mode)
        let tierRaw: String? = try? c.decodeIfPresent(String.self, forKey: .tier)
        tier = tierRaw.flatMap(Tier.init(rawValue:)) ?? .premium
        let langRaw: String? = try? c.decodeIfPresent(String.self, forKey: .lang)
        lang = langRaw.flatMap(AppLang.init(rawValue:))
        createdAt = (try? c.decodeIfPresent(String.self, forKey: .createdAt)) ?? ""
        expiresAt = (try? c.decodeIfPresent(String.self, forKey: .expiresAt)) ?? ""
        judgedAt = try? c.decodeIfPresent(String.self, forKey: .judgedAt)
        respondentAnswered = (try? c.decodeIfPresent(Bool.self, forKey: .respondentAnswered)) == true
        ownerSideMissing = (try? c.decodeIfPresent(Bool.self, forKey: .ownerSideMissing)) == true
        inviteUrl = try? c.decodeIfPresent(String.self, forKey: .inviteUrl)
        sides = (try? c.decodeIfPresent([CaseSide].self, forKey: .sides)) ?? []
        appeals = (try? c.decodeIfPresent([CaseAppeal].self, forKey: .appeals)) ?? []
        canJudgeNow = (try? c.decodeIfPresent(Bool.self, forKey: .canJudgeNow)) == true
        appeal = (try? c.decodeIfPresent(CaseAppealGate.self, forKey: .appeal)) ?? CaseAppealGate()
        lastError = try? c.decodeIfPresent(String.self, forKey: .lastError)
        pollAfterMs = try? c.decodeIfPresent(Double.self, forKey: .pollAfterMs)
        names = try? c.decodeIfPresent([NameMapping].self, forKey: .names)
        display = (try? c.decodeIfPresent(CaseDisplay.self, forKey: .display)) ?? CaseDisplay()
        removed = try? c.decodeIfPresent(CaseRemoval.self, forKey: .removed)
        yourOriginal = (try? c.decodeIfPresent(String.self, forKey: .yourOriginal)) ?? "not_stored"
        parties = manyParties(try? c.decodeIfPresent([Party].self, forKey: .parties))
        invites = parties == nil ? nil : (try? c.decodeIfPresent([CaseInvite].self, forKey: .invites))
        canJudgeAnswered = (try? c.decodeIfPresent(Bool.self, forKey: .canJudgeAnswered)) == true
        venue = try? c.decodeIfPresent(String.self, forKey: .venue)
    }
}

enum CaseDecoding {
    /// A CaseView JSON object.
    static func view(_ object: [String: Any]) throws -> CaseView {
        let data = try JSONSerialization.data(withJSONObject: object)
        let wire = try JSONDecoder().decode(CaseViewWire.self, from: data)
        let verdicts = ((object["verdicts"] as? [Any]) ?? []).compactMap { entry -> CaseVerdict? in
            guard let verdict = entry as? [String: Any],
                  let id = verdict["id"] as? String, !id.isEmpty,
                  let raw = try? WireDecoding.rawResult(verdict["result"])
            else { return nil }
            return CaseVerdict(
                seq: (verdict["seq"] as? NSNumber)?.intValue ?? 0,
                id: id,
                result: raw,
                appealId: verdict["appealId"] as? String,
                createdAt: (verdict["createdAt"] as? String) ?? ""
            )
        }
        return CaseView(
            id: wire.id,
            role: wire.role,
            yourParty: wire.yourParty,
            status: wire.status,
            mode: wire.mode,
            tier: wire.tier,
            lang: wire.lang,
            createdAt: wire.createdAt,
            expiresAt: wire.expiresAt,
            judgedAt: wire.judgedAt,
            respondentAnswered: wire.respondentAnswered,
            ownerSideMissing: wire.ownerSideMissing,
            inviteUrl: wire.inviteUrl,
            sides: wire.sides,
            verdicts: verdicts,
            appeals: wire.appeals,
            canJudgeNow: wire.canJudgeNow,
            appeal: wire.appeal,
            lastError: wire.lastError,
            pollAfterMs: wire.pollAfterMs,
            names: wire.names,
            display: wire.display,
            removed: wire.removed,
            yourOriginal: wire.yourOriginal,
            parties: wire.parties,
            invites: wire.invites,
            canJudgeAnswered: wire.canJudgeAnswered,
            venue: wire.venue
        )
    }

    /// `{ case: CaseView, ... }`.
    static func envelope(_ data: Data) throws -> CaseView {
        let object = try WireDecoding.topLevelObject(data)
        guard let view = object["case"] as? [String: Any] else { throw WireDecodingError.missing("case") }
        return try self.view(view)
    }

    /// `{ case, name_map, entitlement? }`.
    static func submission(_ data: Data) throws -> CaseSubmission {
        let object = try WireDecoding.topLevelObject(data)
        guard let view = object["case"] as? [String: Any] else { throw WireDecodingError.missing("case") }
        return CaseSubmission(
            view: try self.view(view),
            nameMap: WireDecoding.nameMapList(object["name_map"]),
            entitlement: WireDecoding.entitlement(in: object)
        )
    }

    /// The rounds and the writer's gate in a ready GET /api/v1/verdicts/{id}
    /// (`appeals`, `owner.appeal`).
    static func rounds(_ data: Data) throws -> VerdictRounds {
        struct Owner: Decodable {
            var appeal: CaseAppealGate?
        }
        struct Answer: Decodable {
            var appeals: [VerdictAppealRound]?
            var owner: Owner?
        }
        let answer = try JSONDecoder().decode(Answer.self, from: data)
        return VerdictRounds(appeals: answer.appeals ?? [], gate: answer.owner?.appeal)
    }

    /// `{ appeal, appeals, poll, pollAfterMs, name_map, entitlement?, replayed? }`.
    static func verdictAppeal(_ data: Data) throws -> VerdictAppealSubmission {
        struct Answer: Decodable {
            var appeal: VerdictAppealRound
            var appeals: [VerdictAppealRound]?
        }
        let answer = try JSONDecoder().decode(Answer.self, from: data)
        guard !answer.appeal.id.isEmpty else { throw WireDecodingError.missing("appeal") }
        let object = try WireDecoding.topLevelObject(data)
        let wait = (object["pollAfterMs"] as? NSNumber)?.doubleValue
        return VerdictAppealSubmission(
            appeal: answer.appeal,
            appeals: answer.appeals ?? [answer.appeal],
            accepted: VerdictAccepted(
                id: answer.appeal.id,
                nameMap: WireDecoding.nameMapList(object["name_map"]),
                pollAfterMs: wait.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil },
                entitlement: WireDecoding.entitlement(in: object),
                replayed: (object["replayed"] as? Bool) ?? false
            )
        )
    }

    /// `{ cases: [CaseSummary], next }`.
    static func list(_ data: Data) throws -> [CaseSummary] {
        struct Answer: Decodable {
            var cases: [CaseSummary]
        }
        return try JSONDecoder().decode(Answer.self, from: data).cases
    }
}
