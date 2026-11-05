import XCTest
@testable import Judge

/// Which stage the Mids act out for a point of the judging timeline, and
/// what each stage asks of them.
final class JudgingStageTests: XCTestCase {
    func testTheStoryAdvancesWithTheSteps() {
        let expected: [JudgingStage] = [.gather, .huddle, .lineUp, .read, .examine, .examine, .weigh, .weigh, .vote]
        for (step, stage) in expected.enumerated() {
            XCTAssertEqual(JudgingStage.of(.loop(step: step, cycle: 0), done: false, finished: false), stage, "step \(step)")
        }
    }

    func testLaterCyclesKeepWeighing() {
        for step in [0, 3, 6, 8] {
            XCTAssertEqual(JudgingStage.of(.loop(step: step, cycle: 1), done: false, finished: false), .weigh, "step \(step)")
        }
    }

    func testTheVerdictShowsTheVotesThenCheers() {
        XCTAssertEqual(JudgingStage.of(.loop(step: 2, cycle: 0), done: true, finished: false), .vote)
        XCTAssertEqual(JudgingStage.of(.loop(step: 0, cycle: 2), done: true, finished: false), .vote)
        for from in [0, 4, 6, 8] {
            let entry = Thinking.finishEntry(fromLoopStep: from)
            XCTAssertEqual(JudgingStage.of(.finish(step: entry, from: from, cycle: 0), done: true, finished: false), .vote, "from \(from)")
        }
        XCTAssertEqual(JudgingStage.of(.loop(step: 5, cycle: 0), done: true, finished: true), .cheer)
    }

    func testFlagsFollowTheJudges() {
        XCTAssertEqual(JudgingStage.flags([.pending, .vote(.a), .vote(.b), .vote(.other)]), [nil, .a, .b, nil])
        XCTAssertEqual(JudgingStage.flags(Thinking.judgeDots(nil)), [nil, nil, nil])
    }

    func testAVoteWithoutAFlagStaysNeutral() {
        let neutral = JudgingStage.vote.pose(0, moving: false, age: 0, flag: nil)
        XCTAssertNil(neutral.flag)
        XCTAssertEqual(neutral.arms, .down)
        let flagged = JudgingStage.vote.pose(0, moving: false, age: 0, flag: .b)
        XCTAssertEqual(flagged.flag, .b)
        XCTAssertEqual(flagged.arms, .up)
        XCTAssertNil(JudgingStage.weigh.pose(0, moving: false, age: 0, flag: .a).flag)
    }

    func testOnlyTheMiddleMidHoldsTheBalance() {
        let arms = (0..<3).map { JudgingStage.weigh.pose($0, moving: false, age: 0, flag: nil).arms }
        XCTAssertEqual(arms, [.down, .beam, .down])
    }

    func testEveryStageHasASpotPerMid() {
        let stages: [JudgingStage] = [.gather, .huddle, .lineUp, .read, .examine, .weigh, .vote, .cheer]
        for stage in stages {
            XCTAssertEqual(stage.targets.count, 3)
            for point in stage.targets {
                XCTAssertTrue(point.x >= 50 && point.x <= JudgingStage.size.width - 50, "\(stage) x")
                XCTAssertTrue(point.y >= 60 && point.y <= JudgingStage.size.height - 45, "\(stage) y")
            }
        }
    }
}

final class MidsShiftTests: XCTestCase {
    private func assertEqual(_ a: [CGPoint], _ b: [CGPoint], line: UInt = #line) {
        XCTAssertEqual(a.count, b.count, line: line)
        for (p, q) in zip(a, b) {
            XCTAssertEqual(p.x, q.x, accuracy: 1e-6, line: line)
            XCTAssertEqual(p.y, q.y, accuracy: 1e-6, line: line)
        }
    }

    func testTheWalkRunsFromTheStartToTheSpots() {
        let shift = MidsShift(stage: .gather, since: 10)
        assertEqual(shift.positions(at: 10), JudgingStage.scattered)
        assertEqual(shift.positions(at: 10 + JudgingStage.gather.walkTime), JudgingStage.gather.targets)
        assertEqual(shift.positions(at: 99), JudgingStage.gather.targets)
        XCTAssertTrue(shift.moving(at: 10.5))
        XCTAssertFalse(shift.moving(at: 12))
    }

    func testMovingOnMidWalkContinuesFromWhereTheyAre() {
        let shift = MidsShift(stage: .gather, since: 10)
        let next = shift.moved(to: .lineUp, at: 10.4)
        assertEqual(next.positions(at: 10.4), shift.positions(at: 10.4))
        XCTAssertEqual(next.stage, .lineUp)
        assertEqual(next.positions(at: 20), JudgingStage.lineUp.targets)
    }
}

final class MidsMotionTests: XCTestCase {
    func testCurvesStartAndEndAtTheirEnds() {
        for curve in [Curve.ease, .easeInOut, .hop, .stroll, .pop] {
            XCTAssertEqual(curve.at(0), 0)
            XCTAssertEqual(curve.at(1), 1)
            XCTAssertEqual(curve.at(-1), 0)
            XCTAssertEqual(curve.at(2), 1)
        }
        XCTAssertEqual(Curve.easeInOut.at(0.5), 0.5, accuracy: 1e-6)
    }

    func testEaseInOutNeverGoesBackwards() {
        var last = 0.0
        for i in 0...100 {
            let value = Curve.stroll.at(Double(i) / 100)
            XCTAssertGreaterThanOrEqual(value, last)
            last = value
        }
    }

    func testThePopOvershootsBeforeSettling() {
        let peak = (1..<28).map { Curve.pop.at(Double($0) / 28) }.max() ?? 0
        XCTAssertGreaterThan(peak, 1.05)
    }

    func testTheJumpRunsTwiceThenRests() {
        XCTAssertEqual(MidMotion.jump.figure(at: 0, age: 0.62 * 0.48).lift, -26, accuracy: 1e-6)
        XCTAssertEqual(MidMotion.jump.figure(at: 0, age: 0.62 + 0.62 * 0.48).lift, -26, accuracy: 1e-6)
        XCTAssertEqual(MidMotion.jump.figure(at: 0, age: 1.3), MidFigure())
        XCTAssertEqual(MidMotion.still.figure(at: 3, age: 3), MidFigure())
    }

    func testLoopsStayInTheirRange() {
        for i in 0..<500 {
            let t = Double(i) * 0.037
            XCTAssertLessThanOrEqual(abs(MidsClock.tilt(t)), 11 + 1e-9)
            XCTAssertLessThanOrEqual(abs(MidsClock.wave(t) - 1), 15 + 1e-9)
            let blink = MidsClock.blink(t)
            XCTAssertTrue(blink >= 0.1 - 1e-9 && blink <= 1 + 1e-9)
            XCTAssertTrue((-3 - 1e-9)...1e-9 ~= MidMotion.bob.figure(at: t, age: 0).lift)
        }
        XCTAssertEqual(MidsClock.blink(0), 1)
        XCTAssertEqual(MidsClock.blink(4.2 * 0.96), 0.1, accuracy: 1e-6)
    }

    func testTheGazeEasesToTheBoxAndBack() {
        let down = Gaze().moved(to: true, at: 5)
        XCTAssertEqual(down.value(at: 5), 0)
        XCTAssertEqual(down.value(at: 5 + Gaze.duration), 1, accuracy: 1e-9)
        XCTAssertEqual(down.value(at: 9), 1)
        let halfway = down.value(at: 5.15)
        XCTAssertTrue(halfway > 0 && halfway < 1)
        let back = down.moved(to: false, at: 5.15)
        XCTAssertEqual(back.value(at: 5.15), halfway, accuracy: 1e-9)
        XCTAssertEqual(back.value(at: 6), 0, accuracy: 1e-9)
    }
}

final class MidsWanderTests: XCTestCase {
    func testTheyStartAtTheirSpots() {
        let wander = MidsWander(seed: 3)
        for mid in 0..<3 {
            XCTAssertEqual(wander.pose(mid: mid, at: 0).position, MidsWander.start[mid])
        }
    }

    func testTheSameSeedGivesTheSameMoves() {
        let a = MidsWander(seed: 11)
        let b = MidsWander(seed: 11)
        for i in 0..<200 {
            let t = Double(i) * 0.7
            XCTAssertEqual(a.pose(mid: i % 3, at: t), b.pose(mid: i % 3, at: t))
        }
    }

    func testTheyStayInsideTheirArea() {
        for seed in UInt64(1)...6 {
            let wander = MidsWander(seed: seed)
            for mid in 0..<3 {
                for i in 0..<1200 {
                    let p = wander.pose(mid: mid, at: Double(i) * 0.25).position
                    XCTAssertTrue(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1, "seed \(seed) mid \(mid) tick \(i)")
                }
            }
        }
    }

    func testEveryKindOfMoveShowsUp() {
        let wander = MidsWander(seed: 7)
        var motions = Set<String>()
        var waves = false
        var sits = false
        for i in 0..<4000 {
            let pose = wander.pose(mid: 0, at: Double(i) * 0.1)
            motions.insert("\(pose.motion)")
            waves = waves || pose.arms == .wave
            sits = sits || pose.sits
        }
        XCTAssertTrue(motions.isSuperset(of: ["walk", "jump", "bob"]), "\(motions)")
        XCTAssertTrue(waves)
        XCTAssertTrue(sits)
    }

    func testAWalkEndsOnItsSpotAndStaysThere() {
        let wander = MidsWander(seed: 5)
        var checked = 0
        for n in 1..<300 {
            let start = Double(n) * MidsWander.tick
            guard wander.pose(mid: 1, at: start + 0.5).motion == .walk else { continue }
            let arrived = wander.pose(mid: 1, at: start + MidsWander.stroll + 0.01)
            let later = wander.pose(mid: 1, at: start + MidsWander.tick - 0.01)
            XCTAssertEqual(arrived.position, later.position)
            XCTAssertNotEqual(arrived.motion, .walk)
            checked += 1
        }
        XCTAssertGreaterThan(checked, 5)
    }
}
