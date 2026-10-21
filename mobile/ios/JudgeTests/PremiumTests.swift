import ImageIO
import SwiftData
import UniformTypeIdentifiers
import XCTest
@testable import Judge

/// Answers by "METHOD /path". Each route holds a queue of replies; the last
/// one repeats once the queue runs out. Anything unrouted fails like a dead
/// network. Counts hits under a lock (the stub's request log is unlocked).
final class StubRouter: @unchecked Sendable {
    private let lock = NSLock()
    private var routes: [String: [StubURLProtocol.Reply]] = [:]
    private var hits: [String: Int] = [:]
    private var bodies: [String: [Data]] = [:]
    private var headers: [String: [[String: String]]] = [:]

    func on(_ method: String, _ path: String, _ replies: StubURLProtocol.Reply...) {
        lock.lock()
        defer { lock.unlock() }
        routes["\(method) \(path)"] = replies
    }

    func reply(to request: URLRequest) -> StubURLProtocol.Reply {
        let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        lock.lock()
        defer { lock.unlock() }
        hits[key, default: 0] += 1
        bodies[key, default: []].append(request.httpBody ?? Data())
        headers[key, default: []].append(request.allHTTPHeaderFields ?? [:])
        guard var queue = routes[key], let first = queue.first else {
            return StubURLProtocol.Reply(error: URLError(.notConnectedToInternet))
        }
        if queue.count > 1 {
            queue.removeFirst()
            routes[key] = queue
        }
        return first
    }

    func count(_ method: String, _ path: String) -> Int {
        lock.lock()
        defer { lock.unlock() }
        return hits["\(method) \(path)"] ?? 0
    }

    func sentBodies(_ method: String, _ path: String) -> [Data] {
        lock.lock()
        defer { lock.unlock() }
        return bodies["\(method) \(path)"] ?? []
    }

    func sentHeaders(_ method: String, _ path: String) -> [[String: String]] {
        lock.lock()
        defer { lock.unlock() }
        return headers["\(method) \(path)"] ?? []
    }

    func install() {
        StubURLProtocol.handler = { [self] request in reply(to: request) }
    }
}

/// Shared helpers for the Premium and case suites.
enum PremiumFixtures {
    static func json(_ status: Int, _ object: Any, headers: [String: String] = [:]) throws -> StubURLProtocol.Reply {
        var all = ["Content-Type": "application/json"]
        all.merge(headers) { _, new in new }
        return StubURLProtocol.Reply(status: status, headers: all, body: try JSONSerialization.data(withJSONObject: object))
    }

    static func section(_ key: String) throws -> [String: Any] {
        try XCTUnwrap(Fixtures.verdicts()[key] as? [String: Any], "missing fixture section \(key)")
    }

    static func object(_ key: String, _ name: String) throws -> [String: Any] {
        try XCTUnwrap(section(key)[name] as? [String: Any], "missing fixture \(key).\(name)")
    }

    static func decode<T: Decodable>(_ type: T.Type, _ object: Any) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: object))
    }

    static func config(_ name: String) throws -> ServerConfig {
        try decode(ServerConfig.self, object("config", name))
    }

    static func me(_ name: String) throws -> AccountInfo {
        try decode(AccountInfo.self, object("me", name))
    }

    static func apiError(_ code: String) throws -> StubURLProtocol.Reply {
        let entry = try object("asyncErrors", code)
        return try json(try XCTUnwrap(entry["status"] as? Int), try XCTUnwrap(entry["body"]))
    }

    static func body(_ data: Data?) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(data)) as? [String: Any])
    }

    static let fastPolicy = PollPolicy(
        firstMs: 10, factor: 1.5, maxMs: 20, errorMaxMs: 40, capMs: 100,
        deadlineMs: 10_000, requestTimeout: 5, maxConsecutiveErrors: 3
    )

    /// A signed-in app on a server with Premium, cases and evidence on.
    @MainActor
    static func app(container: ModelContainer, me: String = "credits7", token: String? = "s3ss10n") throws -> AppModel {
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, turnstileSiteKey: "", version: "1", build: "1")
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        let api = JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: token),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self]),
            pollPolicy: fastPolicy
        )
        let app = AppModel(config: config, container: container, defaults: defaults, persistsDraft: false, api: api, caseNames: MemoryCaseNamesStore())
        app.account.preload(config: try self.config("full"), info: token == nil ? nil : try self.me(me))
        app.home.argument = "My friend Sam says a hot dog is a sandwich. I say it is not."
        app.home.inProgressInterval = .milliseconds(10)
        return app
    }

    @MainActor
    static func waitUntil(_ what: String, file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) async throws {
        var waited = 0
        while !condition(), waited < 500 {
            try await Task.sleep(for: .milliseconds(10))
            waited += 1
        }
        XCTAssertTrue(condition(), "timed out waiting for \(what)", file: file, line: line)
    }

    /// An image of the given size and type, drawn in Core Graphics.
    static func image(width: Int, height: Int, type: UTType, properties: [CFString: Any] = [:]) throws -> Data {
        let space = CGColorSpaceCreateDeviceRGB()
        let context = try XCTUnwrap(CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.setFillColor(CGColor(red: 0.8, green: 0.3, blue: 0.2, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width / 2, height: height))
        let image = try XCTUnwrap(context.makeImage())
        let output = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(output as CFMutableData, type.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        XCTAssertTrue(CGImageDestinationFinalize(destination))
        return output as Data
    }
}

// MARK: - Tier

final class TierTests: XCTestCase {
    func testAvailability() throws {
        let full = try PremiumFixtures.config("full")
        let minimal = try PremiumFixtures.config("minimal")
        XCTAssertEqual(TierLogic.availability(config: nil, signedIn: true, entitlement: nil), .hidden)
        XCTAssertEqual(TierLogic.availability(config: minimal, signedIn: true, entitlement: nil), .hidden, "premium off")
        XCTAssertEqual(TierLogic.availability(config: full, signedIn: false, entitlement: nil), .signedOut)
        var noSignIn = full
        noSignIn.signIn = SignInProviders(email: true, dev: true)
        XCTAssertEqual(TierLogic.availability(config: noSignIn, signedIn: false, entitlement: nil), .hidden, "no app sign-in method")
        XCTAssertEqual(TierLogic.availability(config: full, signedIn: true, entitlement: try PremiumFixtures.me("free").entitlement), .locked)
        XCTAssertEqual(TierLogic.availability(config: full, signedIn: true, entitlement: try PremiumFixtures.me("credits7").entitlement), .available)

        XCTAssertEqual(TierLogic.effective(.available, choice: .premium), .premium)
        XCTAssertEqual(TierLogic.effective(.available, choice: .free), .free)
        XCTAssertEqual(TierLogic.effective(.locked, choice: .premium), .free)
        XCTAssertEqual(TierLogic.effective(.signedOut, choice: .premium), .free)
    }

    func testRemaining() throws {
        XCTAssertEqual(TierLogic.remaining(try PremiumFixtures.me("credits7").entitlement), .credits(7))
        XCTAssertEqual(TierLogic.remaining(try PremiumFixtures.me("subscriber").entitlement), .monthly(48))
        XCTAssertNil(TierLogic.remaining(try PremiumFixtures.me("fair_use").entitlement))
        XCTAssertNil(TierLogic.remaining(nil))
    }

    func testNotes() throws {
        for lang in AppLang.allCases {
            XCTAssertNil(TierLogic.note(lang: lang, availability: .hidden, value: .free, entitlement: nil, nudged: true))
            XCTAssertNil(TierLogic.note(lang: lang, availability: .signedOut, value: .free, entitlement: nil, nudged: false))
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .signedOut, value: .free, entitlement: nil, nudged: true),
                TierLogic.Note(text: "", link: .signIn, linkTitle: L10n.tierSignInToUse(lang))
            )

            let fairUse = try XCTUnwrap(PremiumFixtures.me("fair_use").entitlement)
            let date = try XCTUnwrap(ErrorText.formatDate(fairUse.resetsAt, lang: lang))
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .locked, value: .free, entitlement: fairUse, nudged: false),
                TierLogic.Note(text: L10n.tierFairUse(lang, date: date), link: .pricing, linkTitle: L10n.tierGetPremium(lang))
            )
            var undated = fairUse
            undated.resetsAt = nil
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .locked, value: .free, entitlement: undated, nudged: false)?.text,
                L10n.tierFairUseSoon(lang)
            )
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .locked, value: .free, entitlement: try PremiumFixtures.me("no_credits").entitlement, nudged: false)?.text,
                L10n.tierOutOfCredits(lang)
            )
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .locked, value: .free, entitlement: try PremiumFixtures.me("free").entitlement, nudged: false),
                TierLogic.Note(text: L10n.tierInvite(lang), link: .pricing, linkTitle: L10n.tierGetPremium(lang))
            )
            XCTAssertNil(TierLogic.note(lang: lang, availability: .locked, value: .free, entitlement: nil, nudged: false), "account still loading")

            let credits = try PremiumFixtures.me("credits7").entitlement
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .available, value: .premium, entitlement: credits, nudged: false)?.text,
                L10n.tierPremiumHint(lang) + " " + L10n.tierCreditsLeft(lang, n: 7)
            )
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .available, value: .premium, entitlement: try PremiumFixtures.me("subscriber").entitlement, nudged: false)?.text,
                L10n.tierPremiumHint(lang) + " " + L10n.tierMonthlyLeft(lang, n: "48")
            )
            XCTAssertEqual(
                TierLogic.note(lang: lang, availability: .available, value: .free, entitlement: credits, nudged: false)?.text,
                L10n.tierFreeHint(lang)
            )
        }
        XCTAssertEqual(L10n.tierCreditsLeft(.en, n: 1), "1 premium verdict left.")
        XCTAssertEqual(L10n.tierCreditsLeft(.en, n: 7), "7 premium verdicts left.")
    }

    @MainActor
    func testTheChoiceIsRemembered() throws {
        let container = HistoryContainer.inMemory()
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "judge.tests.\(UUID().uuidString)"))
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, turnstileSiteKey: "", version: "1", build: "1")
        let first = AppModel(config: config, container: container, defaults: defaults, tokenStore: MemoryTokenStore(), persistsDraft: false)
        XCTAssertEqual(first.tierChoice, .free, "Free by default")
        first.setTierChoice(.premium)
        let second = AppModel(config: config, container: container, defaults: defaults, tokenStore: MemoryTokenStore(), persistsDraft: false)
        XCTAssertEqual(second.tierChoice, .premium)
        XCTAssertEqual(second.effectiveTier, .free, "a remembered Premium sends nothing premium while signed out")
        withExtendedLifetime(container) {}
    }
}

// MARK: - Config, pricing, decoding

final class PremiumDecodingTests: XCTestCase {
    func testConfigCarriesPricingAndFeatures() throws {
        let full = try PremiumFixtures.config("full")
        XCTAssertTrue(full.premiumEnabled)
        XCTAssertEqual(full.features, PremiumFeatures(cases: true, evidence: true))
        let pricing = try XCTUnwrap(full.pricing)
        XCTAssertFalse(pricing.purchasesEnabled)
        XCTAssertEqual(pricing.packs.map(\.credits), [10, 30])
        XCTAssertEqual(pricing.monthly.fairUseCap, 60)
        XCTAssertEqual(pricing, PricingInfo.fallback, "the fallback mirrors lib/pricing.ts")

        let minimal = try PremiumFixtures.config("minimal")
        XCTAssertEqual(minimal.features, PremiumFeatures())
        let old = try JSONDecoder().decode(ServerConfig.self, from: Data(#"{"signIn":{"google":true},"premiumEnabled":true}"#.utf8))
        XCTAssertEqual(old.features, PremiumFeatures(), "absent features read as off")
        XCTAssertNil(old.pricing)
    }

    func testPriceFormatting() {
        XCTAssertEqual(PricingInfo.format(1.99, lang: .en), "$1.99")
        XCTAssertEqual(PricingInfo.format(1.99 / 10, lang: .en), "$0.20")
        let tr = PricingInfo.format(1.99, lang: .tr)
        XCTAssertTrue(tr.contains("1,99"), tr)
        XCTAssertTrue(tr.contains("$"), tr)
    }

    @MainActor
    func testPremiumFeatureList() {
        XCTAssertEqual(PricingView.premiumFeatures(nil, lang: .en).count, 3)
        XCTAssertEqual(PricingView.premiumFeatures(PremiumFeatures(cases: true, evidence: true), lang: .en).count, 6)
        XCTAssertEqual(
            PricingView.premiumFeatures(PremiumFeatures(cases: false, evidence: true), lang: .en),
            [L10n.pricingPremiumF1(.en), L10n.pricingPremiumF2(.en), L10n.pricingPremiumF3(.en), L10n.pricingPremiumF5(.en)]
        )
    }

    func testAcceptedPremiumBodyCarriesTheEntitlement() throws {
        let accepted = try WireDecoding.acceptedPayload(from: JSONSerialization.data(withJSONObject: PremiumFixtures.object("premiumVerdictResponse", "accepted")))
        XCTAssertEqual(accepted.id, "premium001")
        XCTAssertEqual(accepted.entitlement?.subscription?.used, 13)
        XCTAssertFalse(accepted.replayed)
        let direct = try WireDecoding.verdictPayload(from: JSONSerialization.data(withJSONObject: PremiumFixtures.object("premiumVerdictResponse", "response")))
        XCTAssertEqual(direct.entitlement?.canUsePremium, true)
        XCTAssertTrue(direct.result.result.isPremium)
    }

    func testTwoSidedFieldsAndAppealDecode() throws {
        let views = try XCTUnwrap(PremiumFixtures.section("cases")["views"] as? [String: Any])
        func verdict(_ view: String, _ index: Int) throws -> VerdictResult {
            let object = try XCTUnwrap(views[view] as? [String: Any])
            let verdicts = try XCTUnwrap(object["verdicts"] as? [[String: Any]])
            return try PremiumFixtures.decode(VerdictResult.self, try XCTUnwrap(verdicts[index]["result"]))
        }
        let judged = try verdict("judged", 0)
        XCTAssertTrue(judged.twoSided)
        XCTAssertEqual(judged.agreedFacts?.count, 2)
        XCTAssertEqual(judged.disputedFacts?.first?.finding, .a)
        XCTAssertEqual(judged.disputedFacts?.first?.decisive, true)
        XCTAssertEqual(judged.disputedFacts?.last?.finding, .unsettled)
        XCTAssertEqual(judged.wouldChange?.count, 1)
        XCTAssertEqual(judged.evidenceUsed, EvidenceUsed(a: 0, b: 1))
        XCTAssertNil(judged.appeal)
        XCTAssertEqual(TwoSidedDisplay.evidenceNote(judged, lang: .en), L10n.evidenceUsed(.en, a: "0", b: "1"))

        let overturned = try verdict("appeal_overturned", 1)
        let appeal = try XCTUnwrap(overturned.appeal)
        XCTAssertEqual(appeal.by, .b)
        XCTAssertEqual(appeal.outcome, .overturned)
        XCTAssertEqual(appeal.previousConfidence, 4)
        XCTAssertEqual(appeal.previousVerdict, .sideA)
        XCTAssertEqual(TwoSidedDisplay.confidenceLine(from: 4, to: 3, lang: .en), L10n.appealConfidence(.en, from: "4") + " → 3/5")
        XCTAssertEqual(TwoSidedDisplay.confidenceLine(from: 3, to: 3, lang: .en), L10n.appealConfidenceSame(.en, n: "3"))
        XCTAssertEqual(TwoSidedDisplay.outcomeLabel(.upheld, lang: .tr), L10n.appealOutcomeUpheld(.tr))
        XCTAssertNil(TwoSidedDisplay.outcomeLabel(.unknown, lang: .tr))

        // Real names go into the two-sided text too.
        let names = [NameMapping(original: "I", replacement: "Party A"), NameMapping(original: "Sam", replacement: "Party B")]
        let personal = Names.personalizeResult(judged, nameMap: names, selfLang: .en)
        let disputed = try XCTUnwrap(personal.disputedFacts)
        XCTAssertTrue(disputed[1].partyA.contains("Sam"), disputed[1].partyA)
        XCTAssertFalse(disputed[1].partyA.contains("Party B"), disputed[1].partyA)
        let parties = Names.partyNames(names, lang: .en, selfLang: .en)
        XCTAssertEqual(TwoSidedDisplay.findingText(judged.disputedFacts![0], parties: parties, lang: .en), L10n.twoSidedFindingSelf(.en))
        XCTAssertEqual(TwoSidedDisplay.findingText(judged.disputedFacts![1], parties: parties, lang: .en), L10n.twoSidedFindingUnsettled(.en))
    }

    @MainActor
    func testFactCheckEmptyLineFollowsTheDisputeType() {
        let none = FactCheck(status: .noClaims, claims: [])
        XCTAssertEqual(FactCheckView.emptyText(none, disputeType: .values, lang: .en), L10n.factcheckNone(.en))
        XCTAssertEqual(FactCheckView.emptyText(none, disputeType: .factual, lang: .en), L10n.factcheckNoneFactual(.en))
        XCTAssertEqual(FactCheckView.emptyText(none, disputeType: .mixed, lang: .tr), L10n.factcheckNoneFactual(.tr))
        XCTAssertEqual(FactCheckView.emptyText(FactCheck(status: .unavailable, claims: []), disputeType: .factual, lang: .en), L10n.factcheckUnavailable(.en))
    }

    func testNewErrorCodesAreLocalized() {
        let codes: [(String, String)] = [
            ("case_closed", L10n.errorCaseClosed(.en)), ("case_expired", L10n.errorCaseExpired(.en)),
            ("appeal_used", L10n.errorAppealUsed(.en)), ("not_party", L10n.errorNotParty(.en)),
            ("own_case", L10n.errorOwnCase(.en)), ("too_large", L10n.errorTooLarge(.en)),
            ("unsupported_media", L10n.errorUnsupportedMedia(.en)), ("too_many_files", L10n.errorTooManyFiles(.en)),
            ("evidence_invalid", L10n.errorEvidenceInvalid(.en)), ("anonymize_failed", L10n.errorAnonymizeFailed(.en)),
            ("removed", L10n.errorRemoved(.en)), ("names_unavailable", L10n.errorNamesUnavailable(.en)),
            ("in_progress", L10n.errorInProgress(.en)), ("no_credits", L10n.errorNoCredits(.en)),
            ("premium_required", L10n.errorPremiumRequired(.en)), ("not_configured", L10n.errorNotConfigured(.en)),
        ]
        for (code, message) in codes {
            XCTAssertEqual(ErrorText.apiErrorMessage(ApiErrorBody(error: "English text", code: code), status: 400, lang: .en), message, code)
        }
        XCTAssertEqual(
            ErrorText.apiErrorMessage(ApiErrorBody(error: "x", code: "daily_cap", retryAfterSec: 120), status: 503, lang: .en),
            L10n.errorDailyCap(.en, wait: L10n.waitMinutes(.en, n: "2"))
        )
        XCTAssertEqual(ErrorText.apiErrorMessage(ApiErrorBody(error: "x", code: "fair_use"), status: 402, lang: .tr), L10n.errorFairUseSoon(.tr))
    }
}

// MARK: - Images and evidence

final class EvidenceTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    func testFitWithinAndKeepOriginal() {
        XCTAssertTrue(ImagePreparation.fitWithin(width: 1600, height: 900) == (1600, 900, false))
        XCTAssertTrue(ImagePreparation.fitWithin(width: 3200, height: 1000) == (1600, 500, true))
        XCTAssertTrue(ImagePreparation.fitWithin(width: 1000, height: 4000) == (400, 1600, true))
        XCTAssertTrue(ImagePreparation.keepOriginal(type: "image/png", width: 1600, height: 1600, bytes: 1000))
        XCTAssertTrue(ImagePreparation.keepOriginal(type: "image/gif", width: 10, height: 10, bytes: 1000))
        XCTAssertFalse(ImagePreparation.keepOriginal(type: "image/png", width: 1601, height: 10, bytes: 1000))
        XCTAssertFalse(ImagePreparation.keepOriginal(type: "image/png", width: 10, height: 10, bytes: 6 * 1024 * 1024))
        XCTAssertFalse(ImagePreparation.keepOriginal(type: "image/jpeg", width: 10, height: 10, bytes: 1000))
    }

    func testPreparation() throws {
        let big = try PremiumFixtures.image(width: 2400, height: 1200, type: .png)
        let scaled = try XCTUnwrap(ImagePreparation.prepare(big))
        XCTAssertEqual(scaled.mimeType, "image/jpeg")
        XCTAssertEqual(scaled.width, 1600)
        XCTAssertEqual(scaled.height, 800)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(scaled.data as CFData, nil))
        XCTAssertEqual(CGImageSourceGetType(source) as String?, UTType.jpeg.identifier)

        let small = try PremiumFixtures.image(width: 200, height: 100, type: .png)
        let kept = try XCTUnwrap(ImagePreparation.prepare(small))
        XCTAssertEqual(kept.data, small, "a small PNG goes as it is")
        XCTAssertEqual(kept.mimeType, "image/png")
        XCTAssertEqual(kept.fileExtension, "png")

        let gif = try PremiumFixtures.image(width: 120, height: 80, type: .gif)
        XCTAssertEqual(try XCTUnwrap(ImagePreparation.prepare(gif)).data, gif)

        XCTAssertNil(ImagePreparation.prepare(Data("not an image".utf8)))
    }

    func testReencodingDropsTheLocation() throws {
        let gps: [CFString: Any] = [kCGImagePropertyGPSLatitude: 41.0, kCGImagePropertyGPSLatitudeRef: "N"]
        let photo = try PremiumFixtures.image(width: 300, height: 200, type: .jpeg, properties: [kCGImagePropertyGPSDictionary: gps])
        let before = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(XCTUnwrap(CGImageSourceCreateWithData(photo as CFData, nil)), 0, nil) as? [CFString: Any])
        XCTAssertNotNil(before[kCGImagePropertyGPSDictionary], "the test photo carries a location")

        let prepared = try XCTUnwrap(ImagePreparation.prepare(photo))
        XCTAssertEqual(prepared.mimeType, "image/jpeg")
        XCTAssertEqual(prepared.width, 300)
        XCTAssertNotEqual(prepared.data, photo, "a JPEG is always re-encoded")
        let after = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(XCTUnwrap(CGImageSourceCreateWithData(prepared.data as CFData, nil)), 0, nil) as? [CFString: Any])
        XCTAssertNil(after[kCGImagePropertyGPSDictionary])
    }

    private func evidenceItems(_ count: Int) throws -> [Any] {
        let items = try XCTUnwrap(PremiumFixtures.section("evidenceResponse")["items"] as? [Any])
        return Array(items.prefix(count))
    }

    private func api() -> JudgeAPI {
        JudgeAPI(
            baseURL: AppConfig.production,
            userAgent: "Judge-iOS/test",
            tokenStore: MemoryTokenStore(token: "s3ss10n"),
            session: JudgeAPI.makeSession(protocolClasses: [StubURLProtocol.self])
        )
    }

    @MainActor
    func testUploadStatusesAndTokenOrder() async throws {
        let router = StubRouter()
        router.on("POST", "/api/v1/evidence", try PremiumFixtures.json(200, ["items": try evidenceItems(3)]))
        router.install()
        let png = try PremiumFixtures.image(width: 100, height: 100, type: .png)
        let evidence = EvidenceModel(max: 3)
        let ids = evidence.reserve(3)
        XCTAssertEqual(ids.count, 3)
        XCTAssertTrue(evidence.busy)
        XCTAssertEqual(evidence.items.map(\.status), [.reading, .reading, .reading])

        await evidence.process(ids, files: [png, png, png], api: api())

        XCTAssertEqual(evidence.items.map(\.status), [.ok, .unreadable, .refused])
        XCTAssertFalse(evidence.busy)
        XCTAssertTrue(evidence.full)
        let token = try XCTUnwrap((try evidenceItems(1).first as? [String: Any])?["token"] as? String)
        XCTAssertEqual(evidence.tokens, [token])
        XCTAssertNotNil(evidence.items[0].preview)
        XCTAssertNil(evidence.items[1].token)
        XCTAssertEqual(evidence.items.map(\.n), [1, 2, 3])

        let headers = try XCTUnwrap(router.sentHeaders("POST", "/api/v1/evidence").first)
        let contentType = try XCTUnwrap(headers["Content-Type"])
        XCTAssertTrue(contentType.hasPrefix("multipart/form-data; boundary="), contentType)
        XCTAssertEqual(headers["Authorization"], "Bearer s3ss10n")
        let body = String(decoding: try XCTUnwrap(router.sentBodies("POST", "/api/v1/evidence").first), as: UTF8.self)
        XCTAssertEqual(body.components(separatedBy: "name=\"image\"").count - 1, 3)
        XCTAssertTrue(body.contains("filename=\"image-1.png\""))
        XCTAssertTrue(body.contains("Content-Type: image/png"))

        // Removing one keeps the order of the rest.
        evidence.remove(ids[1])
        XCTAssertEqual(evidence.items.map(\.n), [1, 3])
        XCTAssertFalse(evidence.full)
    }

    @MainActor
    func testUndecodableImagesAreUnsupportedWithoutAnUpload() async throws {
        let router = StubRouter()
        router.install()
        let evidence = EvidenceModel(max: 3)
        let ids = evidence.reserve(2)
        await evidence.process(ids, files: [Data("garbage".utf8), nil], api: api())
        XCTAssertEqual(evidence.items.map(\.status), [.unsupported, .unsupported])
        XCTAssertEqual(router.count("POST", "/api/v1/evidence"), 0)
        XCTAssertTrue(evidence.tokens.isEmpty)
    }

    @MainActor
    func testAFailedUploadMarksEveryImageFailed() async throws {
        let router = StubRouter()
        router.on("POST", "/api/v1/evidence", try PremiumFixtures.json(413, ["error": "x", "code": "too_large"]))
        router.install()
        let evidence = EvidenceModel(max: 3)
        let ids = evidence.reserve(2)
        let png = try PremiumFixtures.image(width: 50, height: 50, type: .png)
        await evidence.process(ids, files: [png, png], api: api())
        XCTAssertEqual(evidence.items.map(\.status), [.failed, .failed])
        XCTAssertEqual(evidence.failure?.code, "too_large")
        XCTAssertEqual(ErrorText.message(try XCTUnwrap(evidence.failure), lang: .en), L10n.errorTooLarge(.en))
    }

    @MainActor
    func testTheLimitIsKept() {
        let evidence = EvidenceModel(max: 3)
        XCTAssertEqual(evidence.reserve(2).count, 2)
        XCTAssertFalse(evidence.overLimit)
        XCTAssertEqual(evidence.reserve(2).count, 1)
        XCTAssertTrue(evidence.overLimit)
        XCTAssertTrue(evidence.reserve(1).isEmpty)
        XCTAssertTrue(evidence.full)
        evidence.clear()
        XCTAssertTrue(evidence.items.isEmpty)
        XCTAssertFalse(evidence.overLimit)
    }

    @MainActor
    func testApplyMapsByIndexAndUnknownStatusesFail() {
        let evidence = EvidenceModel(max: 3)
        let ids = evidence.reserve(3)
        evidence.apply([
            EvidenceUploadItem(index: 2, status: "ok", token: "t3", preview: "three"),
            EvidenceUploadItem(index: 0, status: "ok", token: "t1", preview: "one"),
            EvidenceUploadItem(index: 1, status: "something_new"),
        ], sent: ids)
        XCTAssertEqual(evidence.items.map(\.status), [.ok, .failed, .ok])
        XCTAssertEqual(evidence.tokens, ["t1", "t3"])

        let more = EvidenceModel(max: 1)
        let one = more.reserve(1)
        more.apply([EvidenceUploadItem(index: 0, status: "ok", token: nil)], sent: one)
        XCTAssertEqual(more.items.first?.status, .failed, "ok without a token is not usable")
    }

    func testStatusStrings() {
        XCTAssertEqual(EvidenceItemStatus(server: "too_large"), .tooLarge)
        XCTAssertEqual(EvidenceItemStatus(server: "nope"), .failed)
        XCTAssertEqual(EvidenceItemStatus.tooLarge.text(.en), L10n.evidenceStatusTooLarge(.en))
        XCTAssertEqual(EvidenceItemStatus.ok.text(.tr), L10n.evidenceOk(.tr))
    }
}

// MARK: - The premium flow on Home

final class PremiumFlowTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.handler = nil
        StubURLProtocol.requests = []
    }

    override func tearDown() {
        StubURLProtocol.handler = nil
        super.tearDown()
    }

    private static let verdictPath = "/api/v1/verdict"
    private static let clarifyPath = "/api/v1/clarify"
    private static let mePath = "/api/v1/me"

    private func accepted(pollAfterMs: Int = 10, replayed: Bool = false, nameMap: [[String: String]] = []) throws -> StubURLProtocol.Reply {
        var body = try PremiumFixtures.object("premiumVerdictResponse", "accepted")
        body["pollAfterMs"] = pollAfterMs
        body["name_map"] = nameMap
        if replayed { body["replayed"] = true }
        return try PremiumFixtures.json(202, body)
    }

    private func judging() throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(200, ["id": "premium001", "status": "judging", "pollAfterMs": 10])
    }

    private func ready() throws -> StubURLProtocol.Reply {
        let polls = try XCTUnwrap(PremiumFixtures.section("premiumVerdictResponse")["polls"] as? [String: Any])
        return try PremiumFixtures.json(200, try XCTUnwrap(polls["ready"]))
    }

    private func failedQuota() throws -> StubURLProtocol.Reply {
        let polls = try XCTUnwrap(PremiumFixtures.section("premiumVerdictResponse")["polls"] as? [String: Any])
        return try PremiumFixtures.json(200, try XCTUnwrap(polls["failed_quota"]))
    }

    private func questions(_ name: String) throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(200, try PremiumFixtures.object("clarifyResponse", name))
    }

    private func me(_ name: String) throws -> StubURLProtocol.Reply {
        try PremiumFixtures.json(200, try PremiumFixtures.object("me", name))
    }

    @MainActor
    private func premiumApp(_ router: StubRouter, container: ModelContainer, me: String = "credits7") throws -> AppModel {
        router.install()
        let app = try PremiumFixtures.app(container: container, me: me)
        app.setTierChoice(.premium)
        XCTAssertEqual(app.effectiveTier, .premium)
        return app
    }

    @MainActor
    func testQuestionsShowTheClarifyStepAndNothingIsJudged() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("two_questions"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        XCTAssertTrue(home.isCheckingQuestions)
        XCTAssertFalse(home.canSubmit(), "no second submit while the questions are asked")
        try await PremiumFixtures.waitUntil("the questions") { home.clarify != nil }
        XCTAssertEqual(home.clarify?.questions.map(\.id), ["q1", "q2"])
        XCTAssertFalse(home.isCheckingQuestions)
        XCTAssertFalse(home.isJudging)
        XCTAssertEqual(router.count("POST", Self.verdictPath), 0)

        let sent = try PremiumFixtures.body(router.sentBodies("POST", Self.clarifyPath).first)
        XCTAssertEqual(sent["argument"] as? String, home.argument)
        XCTAssertEqual(sent["lang"] as? String, app.lang.rawValue)
        XCTAssertEqual(router.sentHeaders("POST", Self.clarifyPath).first?["Authorization"], "Bearer s3ss10n")

        home.clarifyBack()
        XCTAssertNil(home.clarify)
        XCTAssertEqual(router.count("POST", Self.verdictPath), 0)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testNoQuestionsJudgeAtOnceWithKeyPollingEntitlementAndRefresh() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try judging(), try ready())
        router.on("GET", Self.mePath, try me("subscriber"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
        XCTAssertTrue(home.judgingPremium)
        XCTAssertTrue(home.arrived?.isPremium == true)
        XCTAssertNil(home.error)

        let headers = try XCTUnwrap(router.sentHeaders("POST", Self.verdictPath).first)
        XCTAssertEqual(headers["Prefer"], "respond-async")
        let key = try XCTUnwrap(headers["Idempotency-Key"])
        XCTAssertFalse(key.isEmpty)
        XCTAssertLessThanOrEqual(key.count, 64)
        XCTAssertNotNil(key.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression), "the server's key format")
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.verdictPath).first)
        XCTAssertEqual(body["tier"] as? String, "premium")
        XCTAssertNil(body["clarifications"])
        XCTAssertNil(body["evidence"])
        XCTAssertNil(body["turnstileToken"], "premium skips the bot check")
        XCTAssertEqual((body["framework"] as? [String: Any])?["preset"] as? String, home.preset)

        // The 202's entitlement first, then /me after the outcome.
        try await PremiumFixtures.waitUntil("the account refresh") { router.count("GET", Self.mePath) >= 1 }
        try await PremiumFixtures.waitUntil("the refreshed balance") { app.account.entitlement?.subscription?.used == 12 }
        XCTAssertEqual(try app.history.find(id: "premium001")?.tier, "premium")
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testTheAcceptedEntitlementShowsWhileJudging() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try judging())
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the balance from the 202") { app.account.entitlement?.subscription?.used == 13 }
        XCTAssertTrue(home.isJudging)
        home.cancel()
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testInProgressIsAskedAgainWithTheSameKey() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let busy = try PremiumFixtures.apiError("in_progress")
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, busy, busy, try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try ready())
        router.on("GET", Self.mePath, try me("credits7"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
        let keys = router.sentHeaders("POST", Self.verdictPath).compactMap { $0["Idempotency-Key"] }
        XCTAssertEqual(keys.count, 3)
        XCTAssertEqual(Set(keys).count, 1, "every retry of the same request carries the same key")
        XCTAssertNil(home.error)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testInProgressGivesUpAfterTheWait() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try PremiumFixtures.apiError("in_progress"))
        let app = try premiumApp(router, container: container)
        app.home.inProgressWait = .milliseconds(60)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the error") { home.error != nil }
        XCTAssertEqual(home.error?.code, "in_progress")
        XCTAssertGreaterThan(router.count("POST", Self.verdictPath), 1)
        XCTAssertFalse(home.isJudging)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testARetryReusesTheKeyAndASuccessRetiresIt() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try PremiumFixtures.json(503, ["error": "x", "code": "unavailable"]), try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try ready())
        router.on("GET", Self.mePath, try me("credits7"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the failure") { home.error != nil }
        XCTAssertEqual(home.error?.code, "unavailable")
        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
        var keys = router.sentHeaders("POST", Self.verdictPath).compactMap { $0["Idempotency-Key"] }
        XCTAssertEqual(keys.count, 2)
        XCTAssertEqual(keys[0], keys[1], "the same request retried keeps its key")

        // After a success the same text is a new request.
        home.judgingFinished()
        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the third post") { router.count("POST", Self.verdictPath) == 3 }
        keys = router.sentHeaders("POST", Self.verdictPath).compactMap { $0["Idempotency-Key"] }
        XCTAssertNotEqual(keys[2], keys[1])
        home.cancel()
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAnswersAndSkippingBuildTheClarifications() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("two_questions"))
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try ready())
        router.on("GET", Self.mePath, try me("credits7"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the questions") { home.clarify != nil }
        home.setAnswer(String(repeating: "x", count: 600), for: "q1")
        XCTAssertEqual(home.clarify?.answers["q1"]?.utf16.count, HomeModel.maxAnswer, "answers stop at 500")
        home.setAnswer("  Never, we argue about it every week.  ", for: "q1")
        home.finishClarify(skip: false, app: app)
        XCTAssertNil(home.clarify)
        try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.verdictPath).first)
        let sent = try XCTUnwrap(body["clarifications"] as? [[String: String]])
        XCTAssertEqual(sent.count, 2)
        XCTAssertEqual(sent[0]["answer"], "Never, we argue about it every week.")
        XCTAssertEqual(sent[1]["answer"], "", "an unanswered question goes with an empty answer")
        XCTAssertEqual(sent[0]["question"], "Did you and Sam ever agree on what counts as a sandwich?")

        let questions = [ClarifyQuestion(id: "a", text: " One? "), ClarifyQuestion(id: "b", text: "Two?"), ClarifyQuestion(id: "c", text: "Three?")]
        let skipped = try XCTUnwrap(HomeModel.clarifications(questions, answers: ["a": "yes"], skip: true))
        XCTAssertEqual(skipped.map(\.answer), ["", ""], "skip sends every answer empty, at most two")
        XCTAssertEqual(skipped.first?.question, "One?")
        XCTAssertNil(HomeModel.clarifications([], answers: [:], skip: false))
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAccountAndInputErrorsStopOnTheForm() async throws {
        for (status, code) in [(402, "no_credits"), (400, "invalid"), (403, "bad_origin"), (402, "fair_use")] {
            StubURLProtocol.requests = []
            let container = HistoryContainer.inMemory()
            let router = StubRouter()
            router.on("POST", Self.clarifyPath, try PremiumFixtures.json(status, ["error": "x", "code": code]))
            router.on("GET", Self.mePath, try me("no_credits"))
            let app = try premiumApp(router, container: container)
            let home = app.home

            home.submit(app: app)
            try await PremiumFixtures.waitUntil("the \(code) error") { home.error != nil }
            XCTAssertEqual(home.error?.code, code)
            XCTAssertNil(home.clarify)
            XCTAssertFalse(home.isJudging)
            XCTAssertEqual(router.count("POST", Self.verdictPath), 0, "\(code) never reaches the verdict")
            if status == 402 {
                try await PremiumFixtures.waitUntil("the account refresh") { router.count("GET", Self.mePath) >= 1 }
                try await PremiumFixtures.waitUntil("the locked tier") { app.tierAvailability == .locked }
            }
            withExtendedLifetime(container) {}
        }
    }

    @MainActor
    func testClarify401EndsTheSession() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try PremiumFixtures.apiError("signin_required"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the sign-out") { !app.account.isSignedIn }
        XCTAssertEqual(app.account.notice, .sessionExpired)
        XCTAssertNil(home.error)
        XCTAssertEqual(router.count("POST", Self.verdictPath), 0)
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testServerTroubleSkipsTheQuestionsSilently() async throws {
        let replies: [StubURLProtocol.Reply] = [
            try PremiumFixtures.json(503, ["error": "x", "code": "unavailable"]),
            try PremiumFixtures.apiError("rate_limited"),
            StubURLProtocol.Reply(error: URLError(.notConnectedToInternet)),
            StubURLProtocol.Reply(status: 200, headers: ["Content-Type": "text/html"], body: Data("<html>".utf8)),
        ]
        for reply in replies {
            StubURLProtocol.requests = []
            let container = HistoryContainer.inMemory()
            let router = StubRouter()
            router.on("POST", Self.clarifyPath, reply)
            router.on("POST", Self.verdictPath, try accepted())
            router.on("GET", "/api/v1/verdicts/premium001", try ready())
            router.on("GET", Self.mePath, try me("credits7"))
            let app = try premiumApp(router, container: container)
            let home = app.home

            home.submit(app: app)
            try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
            XCTAssertNil(home.error)
            XCTAssertNil(home.clarify)
            let body = try PremiumFixtures.body(router.sentBodies("POST", Self.verdictPath).first)
            XCTAssertNil(body["clarifications"])
            withExtendedLifetime(container) {}
        }
    }

    @MainActor
    func testAFailedPremiumVerdictShowsTheErrorAndRefreshes() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try failedQuota())
        router.on("GET", Self.mePath, try me("credits7"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the error") { home.error != nil }
        XCTAssertEqual(home.error?.code, "quota")
        XCTAssertEqual(ErrorText.message(try XCTUnwrap(home.error), lang: .en), L10n.errorQuota(.en))
        try await PremiumFixtures.waitUntil("the account refresh") { router.count("GET", Self.mePath) >= 1 }
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testARefusedPremiumVerdictReadsAsARefusal() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try PremiumFixtures.json(200, ["id": "premium001", "status": "failed", "code": "refused", "error": "x"]))
        router.on("GET", Self.mePath, try me("credits7"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the error") { home.error != nil }
        XCTAssertEqual(ErrorText.message(try XCTUnwrap(home.error), lang: .en), L10n.refusedNote(.en))
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testAReplayedVerdictFetchesTheWritersNames() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try accepted(replayed: true))
        router.on("GET", "/api/v1/verdicts/premium001", try ready())
        router.on("GET", "/api/v1/verdicts/premium001/mine", try PremiumFixtures.json(200, [
            "id": "premium001", "nameMap": [["original": "Sam", "replacement": "Party B"]],
        ]))
        router.on("GET", Self.mePath, try me("credits7"))
        let app = try premiumApp(router, container: container)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
        XCTAssertEqual(home.session("premium001")?.nameMap, [NameMapping(original: "Sam", replacement: "Party B")])
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testReadingEvidenceBlocksSubmitAndOnlyReadTokensGoInOrder() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        router.on("POST", Self.clarifyPath, try questions("none"))
        router.on("POST", Self.verdictPath, try accepted())
        router.on("GET", "/api/v1/verdicts/premium001", try ready())
        router.on("GET", Self.mePath, try me("credits7"))
        let app = try premiumApp(router, container: container)
        let home = app.home
        XCTAssertTrue(app.evidenceOn)

        let ids = home.evidence.reserve(3)
        XCTAssertFalse(home.canSubmit(evidenceOn: app.evidenceOn), "images still being read hold the submit")
        home.submit(app: app)
        XCTAssertEqual(router.count("POST", Self.clarifyPath), 0)

        home.evidence.apply([
            EvidenceUploadItem(index: 0, status: "ok", token: "tok-1", preview: "one"),
            EvidenceUploadItem(index: 1, status: "unreadable"),
            EvidenceUploadItem(index: 2, status: "ok", token: "tok-3", preview: "three"),
        ], sent: ids)
        XCTAssertTrue(home.canSubmit(evidenceOn: app.evidenceOn))
        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.verdictPath).first)
        XCTAssertEqual(body["evidence"] as? [String], ["tok-1", "tok-3"])

        // An expired token comes back as evidence_invalid.
        XCTAssertEqual(
            ErrorText.apiErrorMessage(ApiErrorBody(error: "x", code: "evidence_invalid"), status: 400, lang: .en),
            L10n.errorEvidenceInvalid(.en)
        )
        withExtendedLifetime(container) {}
    }

    @MainActor
    func testFreeTierStillSendsAFreeVerdict() async throws {
        let container = HistoryContainer.inMemory()
        let router = StubRouter()
        let sample = try XCTUnwrap(Fixtures.verdicts()["verdictResponses"] as? [String: Any])["win_a_self"]
        router.on("POST", Self.verdictPath, try PremiumFixtures.json(200, try XCTUnwrap(sample)))
        let app = try premiumApp(router, container: container)
        app.setTierChoice(.free)
        let home = app.home

        home.submit(app: app)
        try await PremiumFixtures.waitUntil("the verdict") { home.arrived != nil }
        XCTAssertEqual(router.count("POST", Self.clarifyPath), 0)
        let body = try PremiumFixtures.body(router.sentBodies("POST", Self.verdictPath).first)
        XCTAssertEqual(body["tier"] as? String, "free")
        XCTAssertNil(router.sentHeaders("POST", Self.verdictPath).first?["Idempotency-Key"])
        XCTAssertFalse(home.judgingPremium)
        withExtendedLifetime(container) {}
    }
}
