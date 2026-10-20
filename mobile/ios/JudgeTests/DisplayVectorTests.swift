import XCTest
@testable import Judge

/// The native display ports against outputs computed by the website's own
/// code (npx tsx mobile/shared/fixtures/export-fixtures.ts).
final class DisplayVectorTests: XCTestCase {
    func testVerdictVectors() throws {
        let vectors = try Fixtures.list("verdicts", in: Fixtures.vectors())
        XCTAssertFalse(vectors.isEmpty)
        for vector in vectors {
            let name = try XCTUnwrap(vector["sample"] as? String)
            let lang = try Fixtures.lang(vector["lang"])
            let payload = try Fixtures.sample(name)
            let result = payload.result.result
            let context = "\(name)/\(lang.rawValue)"

            let selfLang = ContentLang.verdictLang(result)
            XCTAssertEqual(selfLang, try Fixtures.lang(vector["selfLang"]), context)

            let parties = Names.partyNames(payload.nameMap, lang: lang, selfLang: selfLang)
            XCTAssertEqual(parties.nameA, vector["nameA"] as? String, context)
            XCTAssertEqual(parties.nameB, vector["nameB"] as? String, context)
            XCTAssertEqual(parties.aIsSelf, vector["aIsSelf"] as? Bool, context)
            XCTAssertEqual(parties.bIsSelf, vector["bIsSelf"] as? Bool, context)

            XCTAssertEqual(VerdictDisplay.label(result.verdict, parties: parties, lang: lang), vector["label"] as? String, context)
            XCTAssertEqual(VerdictDisplay.tugFinal(result), (vector["tugA"] as? NSNumber)?.intValue, context)
            let expectedDegrees = try XCTUnwrap((vector["svgRotateDeg"] as? NSNumber)?.doubleValue, context)
            XCTAssertEqual(VerdictDisplay.rotationDegrees(tugA: VerdictDisplay.tugFinal(result)), expectedDegrees, accuracy: 0.001, context)
            XCTAssertEqual(CruxStyle.of(result.crux).rawValue, vector["cruxStyle"] as? String, context)

            if let tally = vector["leanTally"] as? [String: Any] {
                let lean = try XCTUnwrap(result.lean.value, context)
                let computed = VerdictDisplay.leanTally(lean, runCount: result.runs.count)
                XCTAssertEqual(computed.forValue, (tally["for"] as? NSNumber)?.intValue, context)
                XCTAssertEqual(computed.against, (tally["against"] as? NSNumber)?.intValue, context)
            } else {
                XCTAssertNil(result.lean.value, context)
            }

            let config = AppConfig(apiBaseURL: AppConfig.production, shareBaseURL: AppConfig.production, turnstileSiteKey: "", version: "1", build: "1")
            XCTAssertEqual(config.shareURL(id: payload.id).absoluteString, vector["shareUrl"] as? String, context)
        }
    }

    func testNameVectors() throws {
        for vector in try Fixtures.list("names", in: Fixtures.vectors()) {
            let lang = try Fixtures.lang(vector["lang"])
            let selfLang = try Fixtures.lang(vector["selfLang"])
            let context = "\(vector["case"] as? String ?? "?")/\(lang.rawValue)"
            let parties = Names.partyNames(Fixtures.nameMap(vector["nameMap"]), lang: lang, selfLang: selfLang)
            XCTAssertEqual(parties.nameA, vector["nameA"] as? String, context)
            XCTAssertEqual(parties.nameB, vector["nameB"] as? String, context)
            XCTAssertEqual(parties.aIsSelf, vector["aIsSelf"] as? Bool, context)
            XCTAssertEqual(parties.bIsSelf, vector["bIsSelf"] as? Bool, context)
        }
    }

    func testWaitVectors() throws {
        for vector in try Fixtures.list("waits", in: Fixtures.vectors()) {
            let lang = try Fixtures.lang(vector["lang"])
            let seconds = (vector["seconds"] as? NSNumber)?.doubleValue
            XCTAssertEqual(ErrorText.formatWait(seconds, lang: lang), vector["text"] as? String, "\(String(describing: seconds))/\(lang)")
        }
    }

    func testErrorVectors() throws {
        for vector in try Fixtures.list("errors", in: Fixtures.vectors()) {
            let lang = try Fixtures.lang(vector["lang"])
            let status = (vector["status"] as? NSNumber)?.intValue
            let body = try Fixtures.errorBody(vector["body"])
            let message = ErrorText.apiErrorMessage(body, status: status, lang: lang)
            XCTAssertEqual(message, vector["message"] as? String, "\(String(describing: body?.code))/\(String(describing: status))/\(lang)")
        }
    }

    func testConfidenceVectors() throws {
        for vector in try Fixtures.list("confidence", in: Fixtures.vectors()) {
            let lang = try Fixtures.lang(vector["lang"])
            let n = try XCTUnwrap((vector["n"] as? NSNumber)?.intValue)
            XCTAssertEqual(VerdictDisplay.confidenceText(n, lang: lang), vector["text"] as? String)
        }
    }

    func testPresetEmojiMatchesWeb() throws {
        let presets = try Fixtures.list("presets", in: Fixtures.vectors())
        XCTAssertEqual(presets.compactMap { $0["id"] as? String }, Preset.all.map(\.id))
        XCTAssertEqual(presets.compactMap { $0["emoji"] as? String }, Preset.all.map(\.emoji))
        for preset in Preset.all {
            XCTAssertNotEqual(preset.label(.en), preset.id, "missing preset label for \(preset.id)")
            XCTAssertNotEqual(preset.label(.tr), preset.id, "missing Turkish preset label for \(preset.id)")
        }
    }

    func testPaletteMatchesWeb() throws {
        let palette = try XCTUnwrap(Fixtures.vectors()["palette"] as? [String: String])
        XCTAssertEqual(Set(palette.keys), Set(PaletteHex.all.keys))
        for (key, hex) in palette {
            let expected = UInt32(hex.dropFirst(), radix: 16)
            XCTAssertEqual(PaletteHex.all[key], expected, key)
        }
        let alpha = try XCTUnwrap(Fixtures.vectors()["paletteAlpha"] as? [String: String])
        XCTAssertEqual(alpha["line"], "rgba(28, 25, 22, \(PaletteHex.lineAlpha))")
        XCTAssertEqual(alpha["line2"], "rgba(28, 25, 22, \(PaletteHex.line2Alpha))")
        XCTAssertEqual(PaletteHex.ink, 0x1C1916, "line colours are ink at an alpha")
    }

    func testThinkingTimelineMatchesWeb() throws {
        let thinking = try XCTUnwrap(Fixtures.vectors()["thinking"] as? [String: Any])
        let steps = try Fixtures.list("steps", in: thinking)
        XCTAssertEqual(steps.compactMap { $0["key"] as? String }, Thinking.steps.map(\.key))
        XCTAssertEqual(steps.compactMap { ($0["ms"] as? NSNumber)?.intValue }, Thinking.steps.map(\.ms))
        let finish = try Fixtures.list("finishSteps", in: thinking)
        XCTAssertEqual(finish.compactMap { $0["name"] as? String }, Thinking.finishSteps.map(\.name))
        XCTAssertEqual(finish.compactMap { ($0["ms"] as? NSNumber)?.intValue }, Thinking.finishSteps.map(\.ms))
        XCTAssertEqual((thinking["maxFinishMs"] as? NSNumber)?.intValue, Thinking.maxFinishMs)
        XCTAssertEqual(thinking["finishKey"] as? String, Thinking.finishKey)
        XCTAssertEqual(thinking["stillJudgingKey"] as? String, Thinking.stillJudgingKey)
        XCTAssertEqual(thinking["readyKey"] as? String, Thinking.readyKey)
        for step in Thinking.steps {
            XCTAssertNotNil(L10n.text(step.key, .en), step.key)
            XCTAssertNotNil(L10n.text(step.key, .tr), step.key)
        }
    }
}
