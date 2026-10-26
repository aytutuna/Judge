import Foundation

/// Port of lib/thinking.ts and lib/thinking-keys.ts: the judging timeline.
/// Loop mode tells the judge's method as a ~15 s story until the verdict
/// arrives; finish mode is a short sequence that hands over to the verdict.
enum Thinking {
    struct Step: Sendable, Equatable {
        let key: String
        let ms: Int
    }

    static let steps: [Step] = [
        Step(key: "thinking.read", ms: 2400),
        Step(key: "thinking.label", ms: 2400),
        Step(key: "thinking.dig", ms: 1100),
        Step(key: "thinking.dig", ms: 1100),
        Step(key: "thinking.dig", ms: 1100),
        Step(key: "thinking.reach", ms: 1300),
        Step(key: "thinking.crux", ms: 2400),
        Step(key: "thinking.judges", ms: 2400),
        Step(key: "thinking.votes", ms: 1200),
    ]

    static let finishSteps: [(name: String, ms: Int)] = [
        ("settle", 600), ("sweep", 900), ("crux", 700), ("out", 250),
    ]

    static let maxFinishMs = 3000
    static let finishKey = "thinking.finish"
    static let stillJudgingKey = "thinking.stillJudging"
    static let readyKey = "thinking.ready"
    /// Hold after the finish sequence so the votes and the tilt read.
    static let revealHoldMs = 900

    enum DigState: Sendable, Equatable, Hashable {
        case loop(step: Int, cycle: Int)
        /// `from` = the loop step the response landed on.
        case finish(step: Int, from: Int, cycle: Int)

        static let initial = DigState.loop(step: 0, cycle: 0)
    }

    struct Plan: Sendable, Equatable {
        /// nil = the sequence is over ("finish" on the web).
        let next: DigState?
        let delayMs: Int
    }

    static func finishEntry(fromLoopStep step: Int) -> Int {
        if step <= 1 { return 0 }
        if step <= 3 { return 1 }
        if step <= 5 { return 2 }
        return 3
    }

    /// The single transition function. `skip` = reduced motion or background.
    static func plan(_ state: DigState, done: Bool, skip: Bool) -> Plan {
        switch state {
        case .loop(let step, let cycle):
            if done {
                if skip { return Plan(next: nil, delayMs: 0) }
                return Plan(next: .finish(step: finishEntry(fromLoopStep: step), from: step, cycle: cycle), delayMs: 0)
            }
            let index = min(max(step, 0), steps.count - 1)
            let last = step >= steps.count - 1
            return Plan(
                next: last ? .loop(step: 0, cycle: cycle + 1) : .loop(step: step + 1, cycle: cycle),
                delayMs: steps[index].ms
            )
        case .finish(let step, let from, let cycle):
            let index = min(max(step, 0), finishSteps.count - 1)
            let delay = finishSteps[index].ms
            if step >= finishSteps.count - 1 { return Plan(next: nil, delayMs: delay) }
            return Plan(next: .finish(step: step + 1, from: from, cycle: cycle), delayMs: delay)
        }
    }

    /// The 3D beat for a state (lib/judging-ui.ts judgingBeatFor): the
    /// story once, then the judges deliberate on later cycles.
    static func beat(for state: DigState) -> SceneBeat {
        switch state {
        case .finish:
            return .orbs
        case .loop(let step, let cycle):
            if cycle >= 1 { return .deliberate }
            switch step {
            case ...0: return .lift
            case 1: return .sort
            case 2...5: return .dig
            case 6: return .crux
            default: return .orbs
            }
        }
    }

    /// Key of the polite live-region text, also used as the visible caption:
    /// the story once, "still judging" on later cycles, "ready" when done.
    static func announcementKey(_ state: DigState, done: Bool) -> String {
        switch state {
        case .finish:
            return readyKey
        case .loop(let step, let cycle):
            if done { return readyKey }
            if cycle != 0 { return stillJudgingKey }
            return steps[min(max(step, 0), steps.count - 1)].key
        }
    }

    /// Judge dots: three neutral ones while waiting, then one per run. A
    /// refusal keeps three neutral dots (no judge ruled).
    enum Dot: Sendable, Equatable {
        case pending
        case vote(VerdictDisplay.Vote)
    }

    static func judgeDots(_ result: VerdictResult?) -> [Dot] {
        let pending: [Dot] = [.pending, .pending, .pending]
        guard let result, !result.modelRefused, !result.runs.isEmpty else { return pending }
        return result.runs.map { .vote(VerdictDisplay.vote($0)) }
    }

    /// Progress bar fill (lib/judging-ui.ts progressAt). Eases toward 92%
    /// (about .62 at 10 s, .82 at 20 s) so it never reaches the end before
    /// the answer and never visibly stalls; 1 once the answer is in.
    static func progressAt(elapsedMs: Double, done: Bool) -> Double {
        if done { return 1 }
        return 0.92 * (1 - exp(-max(0, elapsedMs) / 9000))
    }
}

/// The 2D balance's motion, as pure functions of time so it can be tested
/// and driven from a TimelineView: a ±4° rock while waiting, then a damped
/// spring to the verdict angle.
enum BalanceMotion {
    static let rockAmplitude = 4.0
    static let rockPeriod = 2.4
    static let dampingRatio = 0.55
    static let stiffness = 120.0
    /// After this long the spring is visually at rest.
    static let settleDuration = 1.6

    static func rockAngle(at elapsed: TimeInterval) -> Double {
        rockAmplitude * sin(2 * .pi * elapsed / rockPeriod)
    }

    /// Under-damped spring (unit mass, zero start velocity) from `start` to `target`.
    static func springAngle(from start: Double, to target: Double, elapsed: TimeInterval) -> Double {
        guard elapsed > 0 else { return start }
        if elapsed >= settleDuration * 3 { return target }
        let omega = stiffness.squareRoot()
        let zeta = dampingRatio
        let damped = omega * (1 - zeta * zeta).squareRoot()
        let envelope = exp(-zeta * omega * elapsed)
        let shape = cos(damped * elapsed) + (zeta * omega / damped) * sin(damped * elapsed)
        return target + (start - target) * envelope * shape
    }
}
