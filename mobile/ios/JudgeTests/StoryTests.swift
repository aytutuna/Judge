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

    func testCourtSceneJSON() throws {
        XCTAssertEqual(CourtScene.home(busy: true).json, #"{"kind":"home","busy":true}"#)
        XCTAssertEqual(
            CourtScene.judging(.crux, nil).json,
            #"{"kind":"judging","beat":"crux","votes":[],"extra":0,"winner":null,"trial":null}"#
        )
        let summary = Story.Summary(votes: [.a, .other, .b], escalated: true, extra: 0, winner: .b, trial: .overturned)
        let json = CourtScene.judging(.finale, summary).json
        XCTAssertEqual(json, #"{"kind":"judging","beat":"final","votes":["a","other","b"],"extra":0,"winner":"b","trial":"overturned"}"#)
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
