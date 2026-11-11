import XCTest
@testable import Judge

/// Verdicts with three or four sides against the website's own output
/// (verdicts.json manySidedResponses, display-vectors.json manySided and
/// story-vectors.json summaries).
final class ManySidedTests: XCTestCase {
    private static let samples = ["three_win_c", "four_win_d_separate_accounts", "three_too_close", "four_win_a"]

    func testTheNewFieldsDecode() throws {
        let win = try Fixtures.manySample("three_win_c").result.result
        XCTAssertEqual(win.parties, [.a, .b, .c])
        XCTAssertEqual(win.winner, .c)
        XCTAssertEqual(win.votes, [.c, .c, .a])
        XCTAssertEqual(win.sides?.map(\.party), [.a, .b, .c])
        XCTAssertEqual(win.sides?.last?.claims.first?.kind, .fact)
        XCTAssertEqual(win.others?.map(\.party), [.a, .b])
        XCTAssertEqual(win.sideCount, 3)
        XCTAssertEqual(win.verdict, .tooClose, "the older projection stays valid for old readers")

        let four = try Fixtures.manySample("four_win_d_separate_accounts").result.result
        XCTAssertEqual(four.parties, [.a, .b, .c, .d])
        XCTAssertEqual(four.winner, .d)
        XCTAssertEqual(four.evidenceUsed, EvidenceUsed(a: 1, b: 0, c: 1, d: 0))
        XCTAssertEqual(four.disputes?.first?.finding, .d)
        XCTAssertEqual(four.disputes?.first?.positions.map(\.party), [.a, .c, .d])
        XCTAssertEqual(four.disputes?.last?.finding, .unsettled)
        XCTAssertEqual(four.disputes?.first?.decisive, true)

        let tie = try Fixtures.manySample("three_too_close").result.result
        XCTAssertNil(tie.winner)
        XCTAssertEqual(tie.votes, [.a, .other, .c])
    }

    func testTwoSidedVerdictsCarryNoManySidedFields() throws {
        for name in try Fixtures.sampleNames() {
            let result = try Fixtures.sample(name).result.result
            XCTAssertNil(result.parties, name)
            XCTAssertNil(result.winner, name)
            XCTAssertNil(result.votes, name)
            XCTAssertEqual(result.sideCount, 2, name)
        }
    }

    func testAnUnknownPartyListLeavesTheOlderProjection() throws {
        let body = #"{"verdict":"too_close","headline":"h","parties":["a","b","q"],"winner":"q","votes":["q"]}"#
        let result = try JSONDecoder().decode(VerdictResult.self, from: Data(body.utf8))
        XCTAssertNil(result.parties, "two known sides is not a many-sided verdict")
        XCTAssertNil(result.winner)
    }

    func testManySidedVectors() throws {
        let vectors = try Fixtures.list("manySided", in: Fixtures.vectors())
        XCTAssertEqual(vectors.count, Self.samples.count * (vectors.count / Self.samples.count), "every sample in every language")
        XCTAssertFalse(vectors.isEmpty)
        for vector in vectors {
            let name = try XCTUnwrap(vector["sample"] as? String)
            let lang = try Fixtures.lang(vector["lang"])
            let context = "\(name)/\(lang.rawValue)"
            let payload = try Fixtures.manySample(name)
            let result = payload.result.result
            let selfLang = ContentLang.verdictLang(result)
            XCTAssertEqual(selfLang, try Fixtures.lang(vector["selfLang"]), context)

            let sides = result.parties ?? []
            XCTAssertEqual(sides.map(\.rawValue), vector["parties"] as? [String], context)
            XCTAssertEqual(result.winner?.rawValue, vector["winner"] as? String, context)

            let names = Names.partyNames(payload.nameMap, lang: lang, selfLang: selfLang, sides: result.sideCount)
            let expectedNames = try XCTUnwrap(vector["names"] as? [String: [String: Any]], context)
            XCTAssertEqual(Set(expectedNames.keys), Set(sides.map(\.rawValue)), context)
            for side in sides {
                XCTAssertEqual(names.name(side), expectedNames[side.rawValue]?["name"] as? String, "\(context)/\(side.rawValue)")
                XCTAssertEqual(names.isSelf(side), expectedNames[side.rawValue]?["self"] as? Bool, "\(context)/\(side.rawValue)")
            }

            let asViewer = try XCTUnwrap(vector["namesAsViewer"] as? [String: [String: [String: Any]]], context)
            for viewer in sides {
                let viewerNames = Names.partyNamesFor(sides, [], lang: lang, selfLang: selfLang, selfParty: viewer.letter, viewerKnown: true)
                for side in sides {
                    let want = asViewer[viewer.rawValue]?[side.rawValue]
                    XCTAssertEqual(viewerNames.name(side), want?["name"] as? String, "\(context)/\(viewer.rawValue)/\(side.rawValue)")
                    XCTAssertEqual(viewerNames.isSelf(side), want?["self"] as? Bool, "\(context)/\(viewer.rawValue)/\(side.rawValue)")
                }
            }

            XCTAssertEqual(VerdictDisplay.label(result, parties: names, lang: lang), vector["label"] as? String, context)
            XCTAssertEqual(VerdictDisplay.confidenceLabel(result, lang: lang), vector["confidence"] as? String, context)
            XCTAssertEqual(VerdictDisplay.tugFinal(result), (vector["tugA"] as? NSNumber)?.intValue, context)

            let outcomes = try XCTUnwrap(vector["outcomes"] as? [String: Any], context)
            for side in sides {
                XCTAssertEqual(Self.word(VerdictDisplay.outcome(result, viewer: side)), outcomes[side.rawValue] as? String, "\(context)/\(side.rawValue)")
            }
            XCTAssertNil(VerdictDisplay.outcome(result, viewer: nil), context)
            XCTAssertTrue(vector["outcomeWithoutViewer"] is NSNull, context)

            try checkRestored(result, payload.nameMap, selfLang: selfLang, vector: try XCTUnwrap(vector["personalized"] as? [String: Any], context), context: context)
        }
    }

    private static func word(_ outcome: VerdictDisplay.Outcome?) -> String? {
        switch outcome {
        case .win: return "win"
        case .lose: return "lose"
        case nil: return nil
        }
    }

    private func checkRestored(_ result: VerdictResult, _ nameMap: [NameMapping], selfLang: AppLang, vector: [String: Any], context: String) throws {
        let restored = Names.personalizeResult(result, nameMap: nameMap, selfLang: selfLang)
        XCTAssertEqual(restored.headline, vector["headline"] as? String, context)
        XCTAssertEqual(restored.why, vector["why"] as? String, context)
        XCTAssertEqual(restored.crux, vector["crux"] as? String, context)
        XCTAssertEqual(restored.factsReliedOn, vector["facts_relied_on"] as? [String], context)
        XCTAssertEqual(restored.agreedFacts, vector["agreed_facts"] as? [String], context)
        XCTAssertEqual(restored.wouldChange, vector["would_change"] as? [String], context)

        let sides = try XCTUnwrap(vector["sides"] as? [[String: Any]], context)
        XCTAssertEqual(restored.sides?.count ?? 0, sides.count, context)
        for (side, want) in zip(restored.sides ?? [], sides) {
            XCTAssertEqual(side.party.rawValue, want["party"] as? String, context)
            XCTAssertEqual(side.claims.map(\.claim), want["claims"] as? [String], context)
            XCTAssertEqual(side.bedrock, want["bedrock"] as? String, context)
        }
        let others = try XCTUnwrap(vector["others"] as? [[String: Any]], context)
        XCTAssertEqual(restored.others?.count ?? 0, others.count, context)
        for (other, want) in zip(restored.others ?? [], others) {
            XCTAssertEqual(other.party.rawValue, want["party"] as? String, context)
            XCTAssertEqual(other.line, want["line"] as? String, context)
        }
        let disputes = try XCTUnwrap(vector["disputes"] as? [[String: Any]], context)
        XCTAssertEqual(restored.disputes?.count ?? 0, disputes.count, context)
        for (dispute, want) in zip(restored.disputes ?? [], disputes) {
            XCTAssertEqual(dispute.fact, want["fact"] as? String, context)
            let positions = try XCTUnwrap(want["positions"] as? [[String: Any]], context)
            XCTAssertEqual(dispute.positions.map(\.party.rawValue), positions.compactMap { $0["party"] as? String }, context)
            XCTAssertEqual(dispute.positions.map(\.says), positions.compactMap { $0["says"] as? String }, context)
        }
    }

    func testStorySummaries() throws {
        let summaries = try Fixtures.list("summaries", in: Fixtures.object("story-vectors"))
        XCTAssertGreaterThan(summaries.count, Self.samples.count)
        for entry in summaries {
            let name = try XCTUnwrap(entry["sample"] as? String)
            let result = try Fixtures.anySample(name).result.result
            let want = try XCTUnwrap(entry["summary"] as? [String: Any], name)
            let summary = Story.summarize(result)
            XCTAssertEqual(summary.votes.map(\.rawValue), want["votes"] as? [String], name)
            XCTAssertEqual(summary.escalated, want["escalated"] as? Bool, name)
            XCTAssertEqual(summary.extra, (want["extra"] as? NSNumber)?.intValue, name)
            XCTAssertEqual(summary.winner?.rawValue, want["winner"] as? String, name)
            XCTAssertEqual(summary.trial?.rawValue, want["trial"] as? String, name)
            XCTAssertEqual(summary.sides, (entry["sides"] as? NSNumber)?.intValue, name)
        }
    }

    func testTheCourtGetsTheSideCountOnlyBeyondTwo() throws {
        let three = try Fixtures.manySample("three_win_c").result.result
        let json = CourtScene.judging(.finale, Story.summarize(three)).json
        XCTAssertEqual(json, #"{"kind":"judging","venue":"court","beat":"final","votes":["c","c","a"],"extra":0,"winner":"c","trial":null,"sides":3}"#)
        XCTAssertTrue(CourtScene.judging(.crux, nil, sides: 4).json.hasSuffix(#","sides":4}"#))
        XCTAssertFalse(CourtScene.judging(.crux, nil).json.contains("sides"))
    }

    func testTheBalanceStaysLevelAndKnowsOnlyTwoSides() throws {
        let win = try Fixtures.manySample("three_win_c").result.result
        XCTAssertEqual(VerdictDisplay.sceneVerdict(win), .verdict(tugA: 50, votes: [.c, .c, .a]))
        XCTAssertEqual(
            SceneMode.verdict(tugA: 50, votes: [.c, .d, .a, .b, .other]).json,
            #"{"kind":"verdict","verdict":{"tugA":50,"votes":["other","other","a","b","other"]}}"#
        )
    }

    func testPartyLabelsNeedMoreThanTwoSidesToBeSides() {
        XCTAssertNil(Names.canonicalLabel("Party C"))
        XCTAssertEqual(Names.canonicalLabel("Party C", sides: 3), "Party C")
        XCTAssertEqual(Names.canonicalLabel("Taraf D'nin", sides: 4), "Party D")
        XCTAssertNil(Names.canonicalLabel("Party D", sides: 3))
        XCTAssertNil(Names.canonicalLabel("Person C", sides: 3), "other people start at E")
        XCTAssertEqual(Names.canonicalLabel("Person E", sides: 3), "Person E")
        XCTAssertEqual(Names.canonicalLabel("Person C"), "Person C")
    }
}
