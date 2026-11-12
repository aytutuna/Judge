import XCTest
@testable import Judge

/// The judging story against outputs computed by the website's own code
/// (npx tsx mobile/shared/fixtures/export-fixtures.ts).
final class StoryTests: XCTestCase {
    private func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    func testWaitingVectors() throws {
        let vectors = try Fixtures.list("waiting", in: Fixtures.object("story-vectors"))
        XCTAssertFalse(vectors.isEmpty)
        for vector in vectors {
            let elapsed = try XCTUnwrap(number(vector["elapsed"]))
            let accepted = number(vector["acceptedAt"])
            XCTAssertEqual(
                Story.waitingAt(elapsed, acceptedAt: accepted),
                (vector["index"] as? NSNumber)?.intValue,
                "\(elapsed)/\(String(describing: accepted))"
            )
        }
    }

    func testEndingVectors() throws {
        let vectors = try Fixtures.list("endings", in: Fixtures.object("story-vectors"))
        XCTAssertFalse(vectors.isEmpty)
        for vector in vectors {
            let name = try XCTUnwrap(vector["name"] as? String)
            let from = try XCTUnwrap((vector["fromWaiting"] as? NSNumber)?.intValue, name)
            let reduced = try XCTUnwrap(vector["reduced"] as? Bool, name)
            let summary = try (vector["summary"] as? [String: Any]).map(parseSummary)

            let ending = Story.ending(fromWaiting: from, summary: summary, reduced: reduced)

            let expected = try Fixtures.list("steps", in: vector)
            XCTAssertEqual(ending.steps.count, expected.count, name)
            for (step, want) in zip(ending.steps, expected) {
                XCTAssertEqual(step.at, (want["at"] as? NSNumber)?.intValue, name)
                XCTAssertEqual(step.beat.rawValue, want["beat"] as? String, name)
                let line = want["line"] as? [String: Any]
                XCTAssertEqual(step.line?.key, line?["key"] as? String, name)
                let vars = line?["vars"] as? [String: Any]
                XCTAssertEqual(step.line?.vars?.n, (vars?["n"] as? NSNumber)?.intValue, name)
                XCTAssertEqual(step.line?.vars?.total, (vars?["total"] as? NSNumber)?.intValue, name)
                XCTAssertEqual(step.line == nil, line == nil, name)
            }
            XCTAssertEqual(ending.finishAt, (vector["finishAt"] as? NSNumber)?.intValue, name)
            XCTAssertLessThanOrEqual(ending.finishAt, Story.endingMaxMs, name)
        }
    }

    private func parseSummary(_ object: [String: Any]) throws -> Story.Summary {
        let votes = try (object["votes"] as? [String] ?? []).map { raw in
            try XCTUnwrap(VerdictDisplay.Vote(rawValue: raw), raw)
        }
        return Story.Summary(
            votes: votes,
            escalated: object["escalated"] as? Bool ?? false,
            extra: (object["extra"] as? NSNumber)?.intValue ?? 0,
            winner: (object["winner"] as? String).flatMap { Party(rawValue: $0) },
            trial: (object["trial"] as? String).flatMap { CruxTrialOutcome(rawValue: $0) }
        )
    }

    func testAgreementNeedsMoreThanHalf() {
        XCTAssertEqual(Story.agreement([.a, .a, .b]).side, .a)
        XCTAssertEqual(Story.agreement([.a, .a, .b]).n, 2)
        XCTAssertNil(Story.agreement([.a, .b, .other]).side)
        XCTAssertNil(Story.agreement([.a, .a, .b, .b]).side)
        XCTAssertNil(Story.agreement([.a, .a, .b, .other, .other]).side)
        XCTAssertEqual(Story.agreement([.b, .b, .b, .a, .a]).side, .b)
        XCTAssertEqual(Story.agreement([]).n, 0)
    }

    func testSummaryFromSamples() throws {
        let lean = try Fixtures.sample("lean_b_majority_escalated").result.result
        let summary = Story.summarize(lean)
        XCTAssertEqual(summary.votes, [.a, .b, .other, .b, .b])
        XCTAssertTrue(summary.escalated)
        XCTAssertEqual(summary.extra, 2)

        let win = try Fixtures.sample("win_a_self").result.result
        XCTAssertEqual(Story.summarize(win).winner, .a)
        XCTAssertEqual(Story.summarize(win).extra, 0)

        let refused = try Fixtures.sample("refused").result.result
        XCTAssertEqual(Story.summarize(refused).votes, [])
    }

    func testEveryLineHasText() {
        let keys = [
            "story.names", "story.facts", "story.judges", "story.bothSides", "story.crux", "story.ruling",
            "story.count", "story.closeCall", "story.split", "trial.survived", "trial.uncertain", "trial.overturned",
            "thinking.ready",
        ]
        for lang in [AppLang.en, .tr] {
            for key in keys {
                XCTAssertFalse(Story.text(Story.Line(key: key), lang: lang).isEmpty, "\(key)/\(lang)")
            }
            let agree = Story.Line(key: "story.agree", vars: Story.Line.Vars(n: 2, total: 3))
            XCTAssertTrue(Story.text(agree, lang: lang).contains("2"), "\(lang)")
        }
    }

    func testTrialLinesLoseTheirEmoji() {
        XCTAssertEqual(Story.stripLeadingEmoji("🛡️ The ruling held"), "The ruling held")
        XCTAssertEqual(Story.stripLeadingEmoji("⚠️ Doubts"), "Doubts")
        XCTAssertEqual(Story.stripLeadingEmoji("2 of 3 agree"), "2 of 3 agree")
        XCTAssertEqual(Story.stripLeadingEmoji("Plain"), "Plain")
        for outcome in ["survived", "uncertain", "overturned"] {
            let text = Story.text(Story.Line(key: "trial.\(outcome)"), lang: .en)
            XCTAssertEqual(text, Story.stripLeadingEmoji(text), outcome)
            XCTAssertFalse(text.unicodeScalars.first.map { $0.value > 0x7F && $0.properties.isEmoji } ?? true, outcome)
        }
    }

    private func result(_ dispute: DisputeType, _ trial: CruxTrial) -> VerdictResult {
        VerdictResult(
            verdict: .sideA, disputeType: dispute, headline: "", crux: "", splitPoints: nil, conditional: nil,
            argumentMap: .empty, factsReliedOn: [], losingSideBestPoint: "", confidence: 3, runs: [.sideA],
            demo: false, modelRefused: false, cruxTrial: trial, lean: .absent, escalated: false, lang: .en,
            tier: nil, factCheck: nil, panel: nil
        )
    }

    func testDoubtfulTrialLineUsesRestoredNames() {
        let trial = CruxTrial(attack: "Party B disagrees.", outcome: .uncertain, reasoning: "Party B never answered.")
        let nameMap = [NameMapping(original: "Dana", replacement: "Party B")]
        let named = Names.personalizeResult(result(.factual, trial), nameMap: nameMap, selfLang: .en)
        let text = Story.text(Story.Line(key: "trial.uncertain"), lang: .en, result: named)
        XCTAssertTrue(text.contains("Dana"), text)
        XCTAssertFalse(text.contains("Party B"), text)
    }

    func testDoubtfulTrialLineSaysWhy() {
        let line = Story.Line(key: "trial.uncertain")
        let plain = Story.text(line, lang: .en)
        let reasoned = CruxTrial(attack: "Menus vary.", outcome: .uncertain, reasoning: "Only some list it.")
        XCTAssertEqual(Story.text(line, lang: .en, result: result(.factual, reasoned)), plain + ": Only some list it.")
        let bare = CruxTrial(attack: "Menus vary.", outcome: .uncertain, reasoning: " ")
        XCTAssertEqual(Story.text(line, lang: .en, result: result(.factual, bare)), plain + ": Menus vary.")
        let mixed = Story.text(line, lang: .en, result: result(.mixed, reasoned))
        XCTAssertTrue(mixed.hasSuffix(" " + L10n.trialMixedNote(.en)))
    }

    func testCourtSceneJSON() throws {
        XCTAssertEqual(CourtScene.home(busy: true).json, #"{"kind":"home","venue":"court","busy":true}"#)
        XCTAssertEqual(
            CourtScene.judging(.crux, nil).json,
            #"{"kind":"judging","venue":"court","beat":"crux","votes":[],"extra":0,"winner":null,"trial":null}"#
        )
        XCTAssertEqual(CourtScene.home(busy: false, venue: "ice").json, #"{"kind":"home","venue":"ice","busy":false}"#)
        XCTAssertTrue(CourtScene.judging(.crux, nil, venue: "tv").json.hasPrefix(#"{"kind":"judging","venue":"tv","#))
        let summary = Story.Summary(votes: [.a, .other, .b], escalated: true, extra: 0, winner: .b, trial: .overturned)
        let json = CourtScene.judging(.finale, summary).json
        XCTAssertEqual(json, #"{"kind":"judging","venue":"court","beat":"final","votes":["a","other","b"],"extra":0,"winner":"b","trial":"overturned"}"#)
        XCTAssertNotNil(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }

    /// Resources/Court/court.html lands in the app bundle without a project
    /// entry, next to Scene's index.html.
    @MainActor
    func testTheCourtPageIsBundled() throws {
        let url = try XCTUnwrap(CourtBridge.pageURL)
        let html = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(html.contains("judgeCourt"))
    }
}
