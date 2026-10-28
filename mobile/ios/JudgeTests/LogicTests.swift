import XCTest
@testable import Judge

/// Tug/tilt mapping, names, the judging timeline, the balance motion,
/// text helpers and the translation state.
final class TugAndTiltTests: XCTestCase {
    private func result(_ verdict: FinalVerdict, lean: LeanField = .absent, refused: Bool = false) -> VerdictResult {
        VerdictResult(
            verdict: verdict, disputeType: .values, headline: "", crux: "", splitPoints: nil, conditional: nil,
            argumentMap: .empty, factsReliedOn: [], losingSideBestPoint: "", confidence: 3, runs: [.sideA],
            demo: false, modelRefused: refused, cruxTrial: nil, lean: lean, escalated: false, lang: .en,
            tier: nil, factCheck: nil, panel: nil
        )
    }

    private func lean(_ party: Party) -> LeanField {
        .lean(Lean(party: party, unanimous: true, reason: "", tally: nil))
    }

    func testTugFinal() {
        XCTAssertEqual(VerdictDisplay.tugFinal(result(.sideA)), 80)
        XCTAssertEqual(VerdictDisplay.tugFinal(result(.sideB)), 20)
        XCTAssertEqual(VerdictDisplay.tugFinal(result(.tooClose, lean: lean(.a))), 62)
        XCTAssertEqual(VerdictDisplay.tugFinal(result(.split, lean: lean(.b))), 38)
        XCTAssertEqual(VerdictDisplay.tugFinal(result(.conditional, lean: .tie)), 50)
        XCTAssertEqual(VerdictDisplay.tugFinal(result(.dissolved)), 50)
        // A winner ignores a stray lean.
        XCTAssertEqual(VerdictDisplay.tugFinal(result(.sideB, lean: lean(.a))), 20)
    }

    @MainActor
    func testLeanBarFollowsTheVotes() throws {
        var win = result(.sideA)
        win.runs = [.sideA, .sideA, .sideB]
        XCTAssertEqual(try XCTUnwrap(VerdictCard.leanShare(win)), 2.0 / 3.0, accuracy: 0.0001)
        var mixed = result(.sideB)
        mixed.runs = [.sideB, .split, .sideB, .sideA]
        XCTAssertEqual(try XCTUnwrap(VerdictCard.leanShare(mixed)), 1.0 / 3.0, accuracy: 0.0001, "only votes for a side count")
        var close = result(.tooClose)
        close.runs = [.sideA, .sideA, .sideB]
        XCTAssertEqual(VerdictCard.leanShare(close), 0.5, "too close sits in the middle")
        var split = result(.split)
        split.runs = [.split, .split, .sideA]
        XCTAssertEqual(VerdictCard.leanShare(split), 0.5)
        var sideless = result(.conditional)
        sideless.runs = [.conditional, .conditional]
        XCTAssertEqual(VerdictCard.leanShare(sideless), 0.5)
        XCTAssertNil(VerdictCard.leanShare(result(.sideA, refused: true)), "no bar on a refusal")
        var empty = result(.tooClose)
        empty.runs = []
        XCTAssertNil(VerdictCard.leanShare(empty), "no bar without votes")
    }

    func testWinnerEndGoesDown() {
        // Clockwise-positive: negative lowers Party A's (left) end.
        XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: 80), -10.313, accuracy: 0.001)
        XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: 20), 10.313, accuracy: 0.001)
        XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: 62), -4.125, accuracy: 0.001)
        XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: 38), 4.125, accuracy: 0.001)
        XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: 50), 0)
        XCTAssertFalse(VerdictDisplay.rotationDegrees(tugA: 50).sign == .minus, "no -0")
        XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: 100), -0.3 * 180 / .pi, accuracy: 0.0001)
        XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: 140), VerdictDisplay.rotationDegrees(tugA: 100), "clamped")
    }

    func testRefusalKeepsTheBalanceLevel() {
        let refused = result(.tooClose, lean: lean(.a), refused: true)
        XCTAssertEqual(VerdictDisplay.sceneTug(refused), 50)
        XCTAssertEqual(Thinking.judgeDots(refused), [.pending, .pending, .pending])
    }

    func testJudgeDotsFollowRuns() {
        var r = result(.sideA)
        r.runs = [.sideA, .sideB, .split, .sideA]
        XCTAssertEqual(Thinking.judgeDots(r), [.vote(.a), .vote(.b), .vote(.other), .vote(.a)])
        XCTAssertEqual(Thinking.judgeDots(nil).count, 3)
    }

    func testLeanTally() {
        let stored = Lean(party: .a, unanimous: false, reason: "", tally: LeanTally(forValue: 4, against: 1))
        XCTAssertEqual(VerdictDisplay.leanTally(stored, runCount: 5), LeanTally(forValue: 4, against: 1))
        let implied = Lean(party: .a, unanimous: false, reason: "", tally: nil)
        XCTAssertEqual(VerdictDisplay.leanTally(implied, runCount: 3), LeanTally(forValue: 2, against: 1))
    }

    func testPanelSummary() {
        let text = VerdictDisplay.panelSummary(models: ["claude-haiku-4", "claude-sonnet-4", "claude-sonnet-4", "mystery"], lang: .en)
        XCTAssertEqual(text, "Judges: 3 strong + 1 quick")
        XCTAssertEqual(VerdictDisplay.panelSummary(models: ["claude-haiku-4"], lang: .en), "Judges: 1 quick")
        let tr = VerdictDisplay.panelSummary(models: ["a-sonnet", "b-sonnet", "x-haiku", "y-haiku", "z-haiku"], lang: .tr)
        XCTAssertEqual(tr, "Yargıçlar: 2 güçlü + 3 hızlı")
    }
}

final class NamesTests: XCTestCase {
    func testCanonicalLabel() {
        XCTAssertEqual(Names.canonicalLabel("Party A"), "Party A")
        XCTAssertEqual(Names.canonicalLabel("taraf b'ye"), "Party B")
        XCTAssertEqual(Names.canonicalLabel("Taraf B’nin"), "Party B")
        XCTAssertEqual(Names.canonicalLabel("Kişi C"), "Person C")
        XCTAssertEqual(Names.canonicalLabel(" person d "), "Person D")
        XCTAssertNil(Names.canonicalLabel("Party C"))
        XCTAssertNil(Names.canonicalLabel("the party"))
        XCTAssertNil(Names.canonicalLabel("Person A"))
    }

    func testBareName() {
        XCTAssertEqual(Names.bareName("Deniz'in"), "Deniz")
        XCTAssertEqual(Names.bareName("Deniz’e"), "Deniz")
        XCTAssertEqual(Names.bareName("Mark's"), "Mark")
        XCTAssertEqual(Names.bareName("O'Brien"), "O'Brien")
        XCTAssertEqual(Names.bareName("D'angelo"), "D'angelo")
        XCTAssertEqual(Names.bareName("  “Sam”  "), "Sam")
        XCTAssertEqual(Names.bareName("my roommate"), "my roommate")
    }

    func testNarratorOnlyInSlotA() {
        let map = [NameMapping(original: "I", replacement: "Party B"), NameMapping(original: "Sam", replacement: "Party A")]
        let parties = Names.partyNames(map, lang: .en, selfLang: .en)
        XCTAssertEqual(parties.nameA, "Sam")
        XCTAssertEqual(parties.nameB, "I")
        XCTAssertFalse(parties.aIsSelf)
    }

    func testTurkishNarratorUsesTurkishCasing() {
        let map = [NameMapping(original: "BENİM", replacement: "Taraf A")]
        XCTAssertTrue(Names.partyNames(map, lang: .tr, selfLang: .tr).aIsSelf)
        XCTAssertEqual(Names.partyNames(map, lang: .tr, selfLang: .tr).nameA, "Sen")
        XCTAssertFalse(Names.partyNames(map, lang: .en, selfLang: .en).aIsSelf, "Turkish forms only when judged in Turkish")
    }

    func testCapitalizedNameBeatsDescription() {
        let map = [
            NameMapping(original: "my roommate", replacement: "Party B"),
            NameMapping(original: "Chris", replacement: "Party B"),
            NameMapping(original: "Christopher", replacement: "Party B"),
        ]
        XCTAssertEqual(Names.partyNames(map, lang: .en, selfLang: .en).nameB, "Chris")
    }
}

final class ThinkingTests: XCTestCase {
    private let loopSteps = Array(0..<Thinking.steps.count)

    func testTables() {
        XCTAssertEqual(Thinking.steps.count, 9)
        XCTAssertLessThanOrEqual(Thinking.finishSteps.map(\.ms).reduce(0, +), Thinking.maxFinishMs)
        let total = Thinking.steps.map(\.ms).reduce(0, +)
        XCTAssertTrue((14000...17000).contains(total))
    }

    func testLoopAdvancesWithStepDuration() {
        for step in loopSteps.dropLast() {
            XCTAssertEqual(
                Thinking.plan(.loop(step: step, cycle: 3), done: false, skip: false),
                Thinking.Plan(next: .loop(step: step + 1, cycle: 3), delayMs: Thinking.steps[step].ms)
            )
        }
        let last = Thinking.steps.count - 1
        XCTAssertEqual(
            Thinking.plan(.loop(step: last, cycle: 2), done: false, skip: false),
            Thinking.Plan(next: .loop(step: 0, cycle: 3), delayMs: Thinking.steps[last].ms)
        )
        XCTAssertEqual(Thinking.plan(.initial, done: false, skip: false).next, .loop(step: 1, cycle: 0))
    }

    func testDoneAndSkipFinishesImmediately() {
        for step in loopSteps {
            XCTAssertEqual(Thinking.plan(.loop(step: step, cycle: 1), done: true, skip: true), Thinking.Plan(next: nil, delayMs: 0))
        }
    }

    func testDoneEntersFinishMode() {
        for step in loopSteps {
            XCTAssertEqual(
                Thinking.plan(.loop(step: step, cycle: 4), done: true, skip: false),
                Thinking.Plan(next: .finish(step: Thinking.finishEntry(fromLoopStep: step), from: step, cycle: 4), delayMs: 0)
            )
        }
        XCTAssertEqual((0...8).map { Thinking.finishEntry(fromLoopStep: $0) }, [0, 0, 1, 1, 2, 2, 3, 3, 3])
    }

    func testFinishModeIsBounded() {
        var starts: [Thinking.DigState] = []
        for cycle in [0, 1, 5] {
            for step in loopSteps { starts.append(.loop(step: step, cycle: cycle)) }
        }
        for from in loopSteps {
            for step in Thinking.finishEntry(fromLoopStep: from)..<Thinking.finishSteps.count {
                starts.append(.finish(step: step, from: from, cycle: 0))
            }
        }
        for start in starts {
            var state: Thinking.DigState? = start
            var transitions = 0
            var total = 0
            while let current = state {
                let plan = Thinking.plan(current, done: true, skip: false)
                total += plan.delayMs
                state = plan.next
                transitions += 1
                XCTAssertLessThanOrEqual(transitions, 6)
                if transitions > 6 { break }
            }
            XCTAssertLessThanOrEqual(total, Thinking.maxFinishMs)
        }
    }

    func testAnnouncementKeys() {
        XCTAssertEqual(Thinking.announcementKey(.loop(step: 0, cycle: 0), done: false), "thinking.read")
        XCTAssertEqual(Thinking.announcementKey(.loop(step: 3, cycle: 0), done: false), "thinking.dig")
        XCTAssertEqual(Thinking.announcementKey(.loop(step: 3, cycle: 1), done: false), "thinking.stillJudging")
        XCTAssertEqual(Thinking.announcementKey(.loop(step: 3, cycle: 1), done: true), "thinking.ready")
        XCTAssertEqual(Thinking.announcementKey(.finish(step: 0, from: 0, cycle: 0), done: false), "thinking.ready")
    }

    func testProgressEasesTowardNinetyTwoPercent() {
        XCTAssertEqual(Thinking.progressAt(elapsedMs: 0, done: false), 0)
        XCTAssertEqual(Thinking.progressAt(elapsedMs: -500, done: false), 0)
        XCTAssertEqual(Thinking.progressAt(elapsedMs: 10_000, done: false), 0.62, accuracy: 0.01)
        XCTAssertEqual(Thinking.progressAt(elapsedMs: 20_000, done: false), 0.82, accuracy: 0.01)
        XCTAssertEqual(Thinking.progressAt(elapsedMs: 30_000, done: false), 0.89, accuracy: 0.01)
        XCTAssertLessThan(Thinking.progressAt(elapsedMs: 600_000, done: false), 0.92 + 1e-9)
        XCTAssertEqual(Thinking.progressAt(elapsedMs: 1_000, done: true), 1)
    }
}

final class BalanceMotionTests: XCTestCase {
    func testRockStaysWithinFourDegrees() {
        for i in 0..<240 {
            let angle = BalanceMotion.rockAngle(at: Double(i) * 0.01)
            XCTAssertLessThanOrEqual(abs(angle), BalanceMotion.rockAmplitude + 1e-9)
        }
        XCTAssertEqual(BalanceMotion.rockAngle(at: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(BalanceMotion.rockAngle(at: 0.6), 4, accuracy: 1e-9)
    }

    func testSpringStartsAtStartAndSettlesOnTarget() {
        XCTAssertEqual(BalanceMotion.springAngle(from: 3, to: -10.313, elapsed: 0), 3)
        XCTAssertEqual(BalanceMotion.springAngle(from: 3, to: -10.313, elapsed: BalanceMotion.settleDuration), -10.313, accuracy: 0.3)
        XCTAssertEqual(BalanceMotion.springAngle(from: 3, to: -10.313, elapsed: 60), -10.313)
        var overshoot = false
        for i in 1..<160 {
            let angle = BalanceMotion.springAngle(from: 0, to: 10, elapsed: Double(i) * 0.01)
            XCTAssertTrue(angle.isFinite)
            if angle > 10 { overshoot = true }
        }
        XCTAssertTrue(overshoot, "under-damped: the beam overshoots a little, like the web's spring")
    }
}

final class TextHelperTests: XCTestCase {
    func testContentLang() {
        XCTAssertEqual(ContentLang.of("Party B is right"), .en)
        XCTAssertEqual(ContentLang.of("Taraf B haklı"), .tr)
        XCTAssertEqual(ContentLang.of("şimdi"), .tr)
        XCTAssertEqual(ContentLang.of("Taraf Bx and Taraf Ab"), .en, "word boundaries")
        XCTAssertEqual(ContentLang.of("(Taraf A)"), .tr)
    }

    func testCruxStyle() {
        XCTAssertEqual(CruxStyle.of(String(repeating: "a", count: 180)), .serif)
        XCTAssertEqual(CruxStyle.of(String(repeating: "a", count: 181)), .sans)
        XCTAssertEqual(CruxStyle.of("  " + String(repeating: "a ", count: 90) + "\n\n "), .serif, "whitespace collapses")
    }

    func testConditionalClause() {
        XCTAssertEqual(ConditionalClause.format("If you value rules", lang: .en), "you value rules")
        XCTAssertEqual(ConditionalClause.format("You value rules", lang: .en), "you value rules")
        XCTAssertEqual(ConditionalClause.format("Yours wins", lang: .en), "Yours wins")
        XCTAssertEqual(ConditionalClause.format("Party B values rules", lang: .en), "Party B values rules")
        XCTAssertEqual(ConditionalClause.format("Eğer İyilik önemliyse", lang: .tr), "iyilik önemliyse")
        XCTAssertEqual(ConditionalClause.format("If Işık matters", lang: .tr), "ışık matters")
        XCTAssertEqual(ConditionalClause.format("Taraf B haklıysa", lang: .tr), "Taraf B haklıysa")
        XCTAssertEqual(ConditionalClause.format("Deniz haklıysa", lang: .tr, keep: ["Deniz"]), "Deniz haklıysa")
        XCTAssertEqual(ConditionalClause.format("EĞER kurallar önemliyse", lang: .tr), "kurallar önemliyse")
    }

    func testFormatDate() {
        let utc = TimeZone(identifier: "UTC") ?? .current
        XCTAssertEqual(ErrorText.formatDate("2026-11-18T10:00:00.000Z", lang: .en, timeZone: utc), "November 18")
        XCTAssertEqual(ErrorText.formatDate("2026-11-18T10:00:00Z", lang: .tr, timeZone: utc), "18 Kasım")
        XCTAssertNil(ErrorText.formatDate("soon", lang: .en))
        XCTAssertNil(ErrorText.formatDate(nil, lang: .en))
    }

    func testPluralAndPlaceholders() {
        XCTAssertEqual(L10n.judgesVoted(.en, n: 1), "1 independent AI judge voted:")
        XCTAssertEqual(L10n.judgesVoted(.en, n: 3), "3 independent AI judges voted:")
        XCTAssertEqual(L10n.judgesVoted(.tr, n: 5), "5 bağımsız yapay zekâ yargıcı oy verdi:")
        XCTAssertEqual(L10n.appInputCounter(.en, count: "12", max: "6000"), "12 / 6000")
        XCTAssertEqual(L10n.verdictWin(.tr, name: "Deniz"), "Deniz haklı")
        XCTAssertEqual(L10n.leanMajority(.en, forValue: "4", against: "1"), "The judges leaned this way 4–1.")
    }

    func testLanguagePreference() {
        XCTAssertEqual(LangPreference.system.resolved(preferredLanguages: ["tr-TR", "en-US"]), .tr)
        XCTAssertEqual(LangPreference.system.resolved(preferredLanguages: ["en-TR", "tr"]), .en)
        XCTAssertEqual(LangPreference.system.resolved(preferredLanguages: []), .en)
        XCTAssertEqual(LangPreference.tr.resolved(preferredLanguages: ["en"]), .tr)
        XCTAssertEqual(LangPreference.en.resolved(preferredLanguages: ["tr"]), .en)
    }

    func testConfigParsing() {
        XCTAssertEqual(AppConfig.parseOrigin("https://okjudge.com/")?.absoluteString, "https://okjudge.com")
        XCTAssertEqual(AppConfig.parseOrigin("http://192.168.1.20:3000")?.absoluteString, "http://192.168.1.20:3000")
        XCTAssertNil(AppConfig.parseOrigin(""))
        XCTAssertNil(AppConfig.parseOrigin("$(API_BASE_URL)"))
        XCTAssertNil(AppConfig.parseOrigin("ftp://okjudge.com"))
        let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, version: "1.0.0", build: "7")
        XCTAssertEqual(config.shareURL(id: "abc123DEF0").absoluteString, "https://okjudge.com/v/abc123DEF0")
        XCTAssertEqual(config.siteURL("privacy").absoluteString, "https://okjudge.com/privacy")
        XCTAssertEqual(config.userAgent, "Judge-iOS/1.0.0 (7)")
    }

    @MainActor
    func testCapAt6000UTF16Units() {
        XCTAssertEqual(HomeModel.capped(String(repeating: "a", count: 6001)).utf16.count, 6000)
        let emoji = String(repeating: "a", count: 5999) + "😀"
        XCTAssertEqual(HomeModel.capped(emoji), String(repeating: "a", count: 5999), "a surrogate pair is never split")
        XCTAssertEqual(HomeModel.capped("short"), "short")
        let accent = String(repeating: "a", count: 5999) + "e\u{301}"
        XCTAssertEqual(HomeModel.capped(accent), String(repeating: "a", count: 5999), "a combining mark stays with its letter")
        let turkish = String(repeating: "ığüşöç İ", count: 7000)
        let cut = HomeModel.capped(turkish)
        XCTAssertEqual(cut.utf16.count, 6000)
        XCTAssertTrue(turkish.hasPrefix(cut))
    }

    @MainActor
    func testBothSidesJoinIntoOneText() {
        XCTAssertEqual(HomeModel.joined(mine: "mine", theirs: " \n", myName: "Alex", theirName: "Sam", lang: .en), "mine", "one side goes as written")
        XCTAssertEqual(
            HomeModel.joined(mine: " mine\n", theirs: "theirs ", myName: "Alex", theirName: " Sam", lang: .en),
            "Alex says: mine\n\nSam says: theirs"
        )
        XCTAssertEqual(HomeModel.joined(mine: "mine", theirs: "theirs", myName: "", theirName: "", lang: .en), "My side: mine\n\nTheir side: theirs")
        XCTAssertEqual(HomeModel.joined(mine: "", theirs: "theirs", myName: "Alex", theirName: "Sam", lang: .tr), "Sam diyor ki: theirs")

        let sides = HomeModel.sides(mine: "mine", theirs: "  ", myName: " Alex ", theirName: "Sam")
        XCTAssertEqual(sides, [HomeModel.JudgedSide(mine: true, name: "Alex", text: "mine")])
    }

    @MainActor
    func testTryAnExampleFillsBothSidesAndNeverRepeats() throws {
        for lang in AppLang.allCases {
            for example in ExampleCase.all {
                let parts = [example.myName(lang), example.mine(lang), example.theirName(lang), example.theirs(lang)]
                XCTAssertFalse(parts.contains(""), "\(example.id) in \(lang.rawValue)")
            }
        }
        let home = HomeModel()
        home.argument = "Something already typed in the box."
        home.otherName = "Someone"
        var shown: [String] = []
        for _ in 0..<40 {
            home.fillExample(lang: .tr)
            let example = try XCTUnwrap(ExampleCase.all.first { $0.mine(.tr) == home.argument })
            XCTAssertEqual(home.caseName, example.myName(.tr))
            XCTAssertEqual(home.otherName, example.theirName(.tr))
            XCTAssertEqual(home.otherSide, example.theirs(.tr))
            XCTAssertNotEqual(shown.last, example.id, "never the same example twice in a row")
            shown.append(example.id)
        }
        XCTAssertGreaterThan(Set(shown).count, 1)
    }

    @MainActor
    func testNewCaseDropsTheExampleNameButKeepsOneTheUserTyped() {
        let home = HomeModel()
        home.fillExample(lang: .en)
        home.judgeAnother()
        XCTAssertNil(home.caseName, "the account's first name comes back")
        XCTAssertNil(home.otherName)
        XCTAssertTrue(home.isBlank)

        home.fillExample(lang: .en)
        home.caseName = "Ada"
        home.judgeAnother()
        XCTAssertEqual(home.caseName, "Ada")
        XCTAssertTrue(home.isBlank)
    }
}

final class TranslationLogicTests: XCTestCase {
    private func payload(lang: AppLang, translated: Bool = true, valid: Bool = true) throws -> TranslatePayload {
        let sample = try Fixtures.sample("win_a_self")
        return TranslatePayload(id: sample.id, lang: lang, source: .en, translated: translated, result: sample.result, looksValid: valid)
    }

    func testViewStates() throws {
        let original = try Fixtures.sample("win_a_self").result
        XCTAssertEqual(TranslationLogic.view(original: original.result, lang: .en, entry: nil).status, .original)
        XCTAssertEqual(TranslationLogic.view(original: original.result, lang: .tr, entry: nil).status, .loading)
        XCTAssertEqual(TranslationLogic.view(original: original.result, lang: .tr, entry: .result(original)).status, .translated(from: .en))
        XCTAssertEqual(TranslationLogic.view(original: original.result, lang: .tr, entry: .failed(offline: true)).status, .offline)
        XCTAssertEqual(TranslationLogic.view(original: original.result, lang: .tr, entry: .failed(offline: false)).status, .failed)
        XCTAssertEqual(TranslationLogic.view(original: original.result, lang: .tr, entry: .same).status, .original)
    }

    func testEntryForOutcomes() throws {
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertEqual(TranslationLogic.entry(for: .success(try payload(lang: .tr)), lang: .tr, now: now), .result(try payload(lang: .tr).result))
        XCTAssertEqual(TranslationLogic.entry(for: .success(try payload(lang: .en)), lang: .tr, now: now), .failed(offline: false), "wrong language")
        XCTAssertEqual(TranslationLogic.entry(for: .success(try payload(lang: .tr, valid: false)), lang: .tr, now: now), .failed(offline: false))
        XCTAssertEqual(TranslationLogic.entry(for: .success(try payload(lang: .tr, translated: false)), lang: .tr, now: now), .same)
        XCTAssertEqual(TranslationLogic.entry(for: .failure(.offline), lang: .tr, now: now), .failed(offline: true))
        let limited = APIError.server(status: 429, body: ApiErrorBody(code: "rate_limited", retryAfterSec: 30))
        XCTAssertEqual(TranslationLogic.entry(for: .failure(limited), lang: .tr, now: now), .blocked(until: now.addingTimeInterval(30)))
        let long = APIError.server(status: 429, body: ApiErrorBody(code: "rate_limited", retryAfterSec: 99999))
        XCTAssertEqual(TranslationLogic.entry(for: .failure(long), lang: .tr, now: now), .blocked(until: now.addingTimeInterval(600)))
    }

    func testRetryRules() throws {
        let original = try Fixtures.sample("win_a_self").result.result
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertFalse(TranslationLogic.needsFetch(original: original, lang: .en, entry: nil, now: now), "same language")
        XCTAssertTrue(TranslationLogic.needsFetch(original: original, lang: .tr, entry: nil, now: now))
        XCTAssertFalse(TranslationLogic.needsFetch(original: original, lang: .tr, entry: .blocked(until: now.addingTimeInterval(5)), now: now))
        XCTAssertTrue(TranslationLogic.needsFetch(original: original, lang: .tr, entry: .blocked(until: now), now: now))
        let entries: [AppLang: TranslationEntry] = [.tr: .failed(offline: false), .en: .same]
        XCTAssertEqual(TranslationLogic.dropRetryable(entries), [.en: .same])
    }
}
