import SwiftData
import XCTest
@testable import Judge

/// The 3D beats of the judging turn, the scene's verdict and the JSON the
/// bundled page receives.
final class SceneModeTests: XCTestCase {
    func testBeatsFollowTheStory() {
        XCTAssertEqual(Thinking.beat(for: .loop(step: -1, cycle: 0)), .lift)
        XCTAssertEqual(Thinking.beat(for: .loop(step: 0, cycle: 0)), .lift)
        XCTAssertEqual(Thinking.beat(for: .loop(step: 1, cycle: 0)), .sort)
        for step in 2...5 {
            XCTAssertEqual(Thinking.beat(for: .loop(step: step, cycle: 0)), .dig, "step \(step)")
        }
        XCTAssertEqual(Thinking.beat(for: .loop(step: 6, cycle: 0)), .crux)
        XCTAssertEqual(Thinking.beat(for: .loop(step: 7, cycle: 0)), .orbs)
        XCTAssertEqual(Thinking.beat(for: .loop(step: 8, cycle: 0)), .orbs)
    }

    func testLaterCyclesDeliberateAndTheFinishShowsOrbs() {
        XCTAssertEqual(Thinking.beat(for: .loop(step: 0, cycle: 1)), .deliberate)
        XCTAssertEqual(Thinking.beat(for: .loop(step: 6, cycle: 3)), .deliberate)
        XCTAssertEqual(Thinking.beat(for: .finish(step: 0, from: 1, cycle: 0)), .orbs)
        XCTAssertEqual(Thinking.beat(for: .finish(step: 3, from: 6, cycle: 2)), .orbs)
    }

    func testOneLoopOfTheTimeline() {
        var state = Thinking.DigState.initial
        var beats: [SceneBeat] = []
        for _ in 0...Thinking.steps.count {
            beats.append(Thinking.beat(for: state))
            state = Thinking.plan(state, done: false, skip: false).next ?? state
        }
        XCTAssertEqual(beats, [.lift, .sort, .dig, .dig, .dig, .dig, .crux, .orbs, .orbs, .deliberate])
    }

    func testSceneVerdictFromSamples() throws {
        let win = try Fixtures.sample("win_a_self").result.result
        XCTAssertEqual(VerdictDisplay.sceneVerdict(win), .verdict(tugA: 80, votes: [.a, .a, .b]))
        let loss = try Fixtures.sample("win_b_named").result.result
        XCTAssertEqual(VerdictDisplay.sceneVerdict(loss), .verdict(tugA: 20, votes: [.b, .b, .b]))
        let lean = try Fixtures.sample("lean_b_majority_escalated").result.result
        XCTAssertEqual(VerdictDisplay.sceneVerdict(lean), .verdict(tugA: 38, votes: [.a, .b, .other, .b, .b]))
        let conditional = try Fixtures.sample("conditional").result.result
        XCTAssertEqual(VerdictDisplay.sceneVerdict(conditional), .verdict(tugA: 62, votes: [.other, .other, .other]))
    }

    func testRefusalStaysLevelWithNoVotes() throws {
        let refused = try Fixtures.sample("refused").result.result
        XCTAssertTrue(refused.modelRefused)
        XCTAssertEqual(VerdictDisplay.sceneVerdict(refused), .verdict(tugA: 50, votes: []))
        XCTAssertEqual(VerdictDisplay.sceneVerdict(refused).fallbackAngle, 0)
    }

    func testModeJSON() throws {
        XCTAssertEqual(SceneMode.judging(.dig).json, #"{"kind":"judging","beat":"dig"}"#)
        XCTAssertEqual(SceneMode.judging(.deliberate).json, #"{"kind":"judging","beat":"deliberate"}"#)
        XCTAssertEqual(
            SceneMode.verdict(tugA: 80, votes: [.a, .a, .b]).json,
            #"{"kind":"verdict","verdict":{"tugA":80,"votes":["a","a","b"]}}"#
        )
        XCTAssertEqual(SceneMode.verdict(tugA: 50, votes: []).json, #"{"kind":"verdict","verdict":{"tugA":50,"votes":[]}}"#)

        // The page reads it with JSON.parse (mobile/shared/scene/scene.ts parseMode).
        let lean = try Fixtures.sample("lean_b_majority_escalated").result.result
        let json = VerdictDisplay.sceneVerdict(lean).json
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
        XCTAssertEqual(object["kind"] as? String, "verdict")
        let verdict = try XCTUnwrap(object["verdict"] as? [String: Any])
        XCTAssertEqual((verdict["tugA"] as? NSNumber)?.intValue, 38)
        XCTAssertEqual(verdict["votes"] as? [String], ["a", "b", "other", "b", "b"])
    }

    func testFallbackAngleIsTheVerdictTilt() {
        XCTAssertEqual(SceneMode.judging(.lift).fallbackAngle, 0)
        XCTAssertEqual(SceneMode.verdict(tugA: 80, votes: []).fallbackAngle, VerdictDisplay.rotationDegrees(tugA: 80))
        XCTAssertEqual(SceneMode.verdict(tugA: 38, votes: []).fallbackAngle, 4.125, accuracy: 0.001)
    }

    /// The Judge folder is a synchronized group: Resources/Scene/index.html
    /// lands in the app bundle without a project entry.
    @MainActor
    func testTheScenePageIsBundled() throws {
        let url = try XCTUnwrap(SceneBridge.pageURL)
        let html = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(html.contains("judgeScene"))
    }
}

/// The judges' badge, the stamp and the best point title, in both languages.
final class ThreadLabelTests: XCTestCase {
    private func sample(_ name: String, lang: AppLang) throws -> (VerdictResult, PartyNames) {
        let payload = try Fixtures.sample(name)
        let result = payload.result.result
        return (result, Names.partyNames(payload.nameMap, lang: lang, selfLang: ContentLang.verdictLang(result)))
    }

    func testJudgesLabel() throws {
        XCTAssertEqual(VerdictDisplay.judgesLabel(nil, lang: .en), "The judges")
        XCTAssertEqual(VerdictDisplay.judgesLabel(nil, lang: .tr), "Yargıçlar")

        let (refused, _) = try sample("refused", lang: .en)
        XCTAssertEqual(VerdictDisplay.judgesLabel(refused, lang: .en), "The judges", "no runs, no agreement")

        let (win, _) = try sample("win_a_self", lang: .en)
        XCTAssertEqual(VerdictDisplay.judgesLabel(win, lang: .en), "Judges · 2 of 3 agree")
        XCTAssertEqual(VerdictDisplay.judgesLabel(win, lang: .tr), "Yargıçlar · 2/3 aynı fikirde")

        let (unanimous, _) = try sample("win_b_named", lang: .en)
        XCTAssertEqual(VerdictDisplay.judgesLabel(unanimous, lang: .en), "Judges · 3 of 3 agree")

        let (split, _) = try sample("split", lang: .en)
        XCTAssertEqual(VerdictDisplay.judgesLabel(split, lang: .en), "Judges · 2 of 3 agree", "split runs count as agreeing with a split")

        let (close, _) = try sample("lean_b_majority_escalated", lang: .en)
        XCTAssertEqual(VerdictDisplay.judgesLabel(close, lang: .en), "Judges · split")
        XCTAssertEqual(VerdictDisplay.judgesLabel(close, lang: .tr), "Yargıçlar · oylar bölündü")
    }

    func testAgreement() throws {
        let (win, _) = try sample("win_a_self", lang: .en)
        XCTAssertEqual(VerdictDisplay.agreement(win), VerdictDisplay.Agreement(n: 2, total: 3))
        let (close, _) = try sample("lean_b_majority_escalated", lang: .en)
        XCTAssertNil(VerdictDisplay.agreement(close))
        let (refused, _) = try sample("refused", lang: .en)
        XCTAssertNil(VerdictDisplay.agreement(refused))
    }

    func testStampLabelInEnglish() throws {
        let (win, you) = try sample("win_a_self", lang: .en)
        XCTAssertEqual(VerdictDisplay.stampLabel(win.verdict, parties: you, lang: .en), "You're right")
        let (named, names) = try sample("win_b_named", lang: .en)
        XCTAssertEqual(VerdictDisplay.stampLabel(named.verdict, parties: names, lang: .en), "Jordan is right")
        XCTAssertEqual(VerdictDisplay.stampLabel(.split, parties: names, lang: .en), "Split")
        XCTAssertEqual(VerdictDisplay.stampLabel(.conditional, parties: names, lang: .en), "Conditional")
        XCTAssertEqual(VerdictDisplay.stampLabel(.tooClose, parties: names, lang: .en), "Too close")
        XCTAssertEqual(VerdictDisplay.stampLabel(.dissolved, parties: names, lang: .en), "Dissolved")
        XCTAssertEqual(VerdictDisplay.stampLabel(.unknown, parties: names, lang: .en), "Too close")
    }

    func testStampLabelInTurkish() throws {
        let (win, you) = try sample("win_a_self", lang: .tr)
        XCTAssertEqual(VerdictDisplay.stampLabel(win.verdict, parties: you, lang: .tr), "Sen haklısın")
        let (named, names) = try sample("win_b_named", lang: .tr)
        XCTAssertEqual(VerdictDisplay.stampLabel(named.verdict, parties: names, lang: .tr), "Jordan haklı")
        XCTAssertEqual(VerdictDisplay.stampLabel(.split, parties: names, lang: .tr), "Bölünmüş")
        XCTAssertEqual(VerdictDisplay.stampLabel(.conditional, parties: names, lang: .tr), "Duruma bağlı")
        XCTAssertEqual(VerdictDisplay.stampLabel(.tooClose, parties: names, lang: .tr), "Başa baş")
        XCTAssertEqual(VerdictDisplay.stampLabel(.dissolved, parties: names, lang: .tr), "Anlam farkı")
    }

    func testBestPointTitleNamesTheLoser() throws {
        let (_, you) = try sample("win_a_self", lang: .en)
        XCTAssertEqual(VerdictDisplay.bestPointTitle(.sideA, parties: you, lang: .en), "Sam's best point")
        XCTAssertEqual(VerdictDisplay.bestPointTitle(.sideA, parties: you, lang: .tr), "Sam adına en güçlü nokta")
        XCTAssertEqual(VerdictDisplay.bestPointTitle(.sideB, parties: you, lang: .en), "Your best point")
        XCTAssertEqual(VerdictDisplay.bestPointTitle(.sideB, parties: you, lang: .tr), "Senin en güçlü noktan")
        XCTAssertEqual(VerdictDisplay.bestPointTitle(.split, parties: you, lang: .en), L10n.bestPointTitle(.en))
    }
}

/// The Recent row on Home.
final class RecentTests: XCTestCase {
    @MainActor
    private func withStore(_ body: (HistoryStore) throws -> Void) throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            try body(HistoryStore(context: container.mainContext))
        }
    }

    private func session(_ name: String) throws -> VerdictSession {
        let payload = try Fixtures.sample(name)
        return VerdictSession(id: payload.id, original: payload.result, nameMap: payload.nameMap, translations: [:])
    }

    private func day(_ day: Int, hour: Int) throws -> Date {
        try XCTUnwrap(Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour)))
    }

    @MainActor
    func testEmptyHistoryShowsNoRow() throws {
        try withStore { store in
            XCTAssertTrue(Recent.cards(try store.all(), lang: .en).isEmpty)
            XCTAssertTrue(Recent.cards([], lang: .tr).isEmpty)
        }
    }

    @MainActor
    func testCardsAreNewestFirstAndDatedByDay() throws {
        try withStore { store in
            try store.save(try session("win_a_self"), preset: "balanced", now: try day(21, hour: 12))
            try store.save(try session("win_b_named"), preset: "balanced", now: try day(26, hour: 8))
            let now = try day(26, hour: 15)

            let en = Recent.cards(try store.all(), lang: .en, now: now)
            XCTAssertEqual(en.map(\.id), ["winB000001", "abc123DEF0"])
            XCTAssertEqual(en.map(\.date), ["Today", "October 21"])
            XCTAssertEqual(Recent.cards(try store.all(), lang: .tr, now: now).map(\.date), ["Bugün", "21 Ekim"])

            // Display only: the real names go back into the stored headline.
            XCTAssertTrue(en[1].title.contains("Sam"), en[1].title)
            XCTAssertFalse(en[1].title.contains("Party B"), en[1].title)
            XCTAssertEqual(try store.find(id: "abc123DEF0")?.headline.contains("Party B"), true)
        }
    }

    @MainActor
    func testRowStopsAtEight() throws {
        try withStore { store in
            for (offset, name) in try Fixtures.sampleNames().enumerated() {
                try store.save(try session(name), preset: "balanced", now: Date(timeIntervalSince1970: Double(offset) * 60))
            }
            XCTAssertGreaterThan(try store.all().count, Recent.limit)
            XCTAssertEqual(Recent.cards(try store.all(), lang: .en).count, Recent.limit)
        }
    }

    func testDayMonth() throws {
        XCTAssertEqual(Recent.dayMonth(try day(26, hour: 12), lang: .en), "October 26")
        XCTAssertEqual(Recent.dayMonth(try day(26, hour: 12), lang: .tr), "26 Ekim")
    }
}

/// The header's "+" in place of the language switch.
final class NewArgumentTests: XCTestCase {
    @MainActor
    func testTheEmptyHomeHasNothingToClear() {
        let home = HomeModel(preset: Preset.defaultID)
        XCTAssertTrue(home.isBlank)
        home.argument = "My friend Sam says"
        XCTAssertFalse(home.isBlank)
        home.argument = ""
        home.evidence.reserve(1)
        XCTAssertFalse(home.isBlank, "a picked screenshot is something to clear")
    }

    @MainActor
    func testThePlusStartsOverOnHome() throws {
        let container = HistoryContainer.inMemory()
        try withExtendedLifetime(container) {
            let app = try PremiumFixtures.app(container: container)
            app.home.path = [.verdict(id: "abc123DEF0"), .pricing]
            app.tab = .history
            app.newArgument()
            XCTAssertTrue(app.home.path.isEmpty, "back to the empty case card")
            XCTAssertTrue(app.home.isBlank)
            XCTAssertEqual(app.tab, .new)
        }
    }
}
