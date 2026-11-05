import CoreGraphics
import Foundation

/// A CSS-style cubic-bezier easing curve, as the Mids demo uses.
struct Curve: Sendable {
    let x1: Double
    let y1: Double
    let x2: Double
    let y2: Double

    static let ease = Curve(x1: 0.25, y1: 0.1, x2: 0.25, y2: 1)
    static let easeInOut = Curve(x1: 0.42, y1: 0, x2: 0.58, y2: 1)
    static let hop = Curve(x1: 0.3, y1: 0.7, x2: 0.3, y2: 1)
    static let stroll = Curve(x1: 0.45, y1: 0.05, x2: 0.3, y2: 1)
    static let pop = Curve(x1: 0.3, y1: 1.6, x2: 0.5, y2: 1)

    /// The eased value at `progress` (0...1); `pop` overshoots 1 on the way.
    func at(_ progress: Double) -> Double {
        if progress <= 0 { return 0 }
        if progress >= 1 { return 1 }
        var low = 0.0
        var high = 1.0
        for _ in 0..<24 {
            let mid = (low + high) / 2
            if Self.coordinate(x1, x2, mid) < progress { low = mid } else { high = mid }
        }
        return Self.coordinate(y1, y2, (low + high) / 2)
    }

    private static func coordinate(_ a: Double, _ b: Double, _ s: Double) -> Double {
        let r = 1 - s
        return 3 * r * r * s * a + 3 * r * s * s * b + s * s * s
    }
}

private func phase(_ t: Double, _ period: Double) -> Double {
    max(t, 0).truncatingRemainder(dividingBy: period) / period
}

/// 0...1...0 over `2 * half` seconds, eased: CSS `alternate` with ease-in-out.
private func swing(_ t: Double, half: Double) -> Double {
    let p = phase(t, 2 * half)
    return Curve.easeInOut.at(p < 0.5 ? p * 2 : 2 - p * 2)
}

/// A looping animation: `stops` are the keyframe offsets (0...1), `values`
/// what each holds, and every segment eases with `curve`.
private func keyframes(_ stops: [Double], _ values: [Double], at progress: Double, curve: Curve) -> Double {
    var i = 0
    while i < stops.count - 2, progress >= stops[i + 1] { i += 1 }
    let span = stops[i + 1] - stops[i]
    let u = span > 0 ? (progress - stops[i]) / span : 1
    return values[i] + (values[i + 1] - values[i]) * curve.at(u)
}

private func blend(_ a: CGPoint, _ b: CGPoint, _ e: Double) -> CGPoint {
    CGPoint(x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e)
}

/// What the whole figure does: sway, bounce or nod.
enum MidMotion: Equatable, Sendable {
    case still, bob, walk, jump, nod, cheer
}

/// The figure's transform: degrees clockwise about the feet, points of lift
/// (up is negative) and a vertical squash.
struct MidFigure: Equatable, Sendable {
    var angle = 0.0
    var lift = 0.0
    var squash = 1.0
}

extension MidMotion {
    /// `t` is the shared clock; `age` the seconds since this pose began,
    /// which only the one-off jump looks at.
    func figure(at t: Double, age: Double) -> MidFigure {
        switch self {
        case .still:
            return MidFigure()
        case .bob:
            return MidFigure(lift: keyframes([0, 0.5, 1], [0, -3, 0], at: phase(t, 2.4), curve: .easeInOut))
        case .walk:
            let e = swing(t, half: 0.34)
            return MidFigure(angle: -5 + 10 * e, lift: -4 * e)
        case .jump:
            guard age >= 0, age < 2 * 0.62 else { return MidFigure() }
            return Self.hop(phase(age, 0.62))
        case .nod:
            return MidFigure(angle: keyframes([0, 0.3, 0.7, 1], [0, -4, 4, 0], at: phase(t, 1), curve: .easeInOut))
        case .cheer:
            return Self.hop(phase(t, 0.5))
        }
    }

    private static func hop(_ p: Double) -> MidFigure {
        let stops = [0, 0.12, 0.48, 0.86, 1]
        return MidFigure(
            lift: keyframes(stops, [0, 0, -26, 0, 0], at: p, curve: .hop),
            squash: keyframes(stops, [1, 0.88, 1.05, 0.92, 1], at: p, curve: .hop)
        )
    }
}

/// The separate loops: a waving hand, the balance beam, blinking and the
/// magnifying glass sweeping the page.
enum MidsClock {
    static func wave(_ t: Double) -> Double { -14 + 30 * swing(t, half: 0.42) }

    static func tilt(_ t: Double) -> Double {
        keyframes([0, 0.5, 1], [-11, 11, -11], at: phase(t, 2.2), curve: .easeInOut)
    }

    /// Vertical scale of the eyes: open, then a quick blink every 4.2 s.
    static func blink(_ t: Double) -> Double {
        keyframes([0, 0.93, 0.96, 1], [1, 1, 0.1, 1], at: phase(t, 4.2), curve: .ease)
    }

    static func scan(_ t: Double) -> CGPoint {
        let e = swing(t, half: 1.7)
        return CGPoint(x: -12 + 56 * e, y: -4 + 50 * e)
    }
}

enum MidArms: Equatable, Sendable {
    case down, wave, up, hold, beam
}

struct MidPose: Equatable, Sendable {
    var position = CGPoint.zero
    var motion = MidMotion.bob
    var arms = MidArms.down
    var sits = false
    var flag: Party?
    /// Where the eyes rest, in the figure's own units.
    var look = CGPoint.zero
    /// Seconds since the pose began: the jump runs twice, the flag pops up.
    var age = 0.0
}

/// How the eyes turn to the box while someone types, eased over 0.3 s.
struct Gaze: Equatable, Sendable {
    var from = 0.0
    var to = 0.0
    var start = 0.0

    static let duration = 0.3

    func value(at t: TimeInterval) -> Double {
        from + (to - from) * Curve.ease.at((t - start) / Self.duration)
    }

    func moved(to typing: Bool, at t: TimeInterval) -> Gaze {
        Gaze(from: value(at: t), to: typing ? 1 : 0, start: t)
    }
}

/// What the Mids do on the New page: every 1.5 s each one keeps what it was
/// doing or picks something new (walk to a spot, wave, jump or sit). The
/// choices come from a hash of the seed, the Mid and the tick, so a frame
/// needs no stored state, and positions are fractions (0...1) of the area
/// they roam.
struct MidsWander: Sendable {
    let seed: UInt64

    static let tick = 1.5
    static let stroll = 1.4
    static let start = [CGPoint(x: 0.125, y: 0.38), CGPoint(x: 0.52, y: 0.71), CGPoint(x: 0.875, y: 0.29)]
    static let startLook = [5.0, 5.0, -5.0]
    private static let lookback = 48

    private enum Act {
        case walk, wave, jump, sit
    }

    func pose(mid: Int, at t: Double) -> MidPose {
        let n = Int(max(t, 0) / Self.tick)
        var latest: (tick: Int, act: Act)?
        var walks: [Int] = []
        var m = n
        while m >= max(1, n - Self.lookback), walks.count < 2 {
            if let act = roll(mid, m) {
                if latest == nil { latest = (m, act) }
                if act == .walk { walks.append(m) }
            }
            m -= 1
        }

        let to = walks.first.map { spot(mid, $0) } ?? Self.start[mid]
        let from = walks.dropFirst().first.map { spot(mid, $0) } ?? Self.start[mid]
        var pose = MidPose(position: to, look: CGPoint(x: Self.startLook[mid], y: 0))
        var walking = false
        if let w = walks.first {
            let progress = (t - Double(w) * Self.tick) / Self.stroll
            pose.position = blend(from, to, Curve.stroll.at(progress))
            pose.look = CGPoint(x: to.x < from.x ? -5 : 5, y: 0)
            walking = progress < 1
        }
        if let latest {
            switch latest.act {
            case .walk:
                pose.motion = walking ? .walk : .bob
            case .wave:
                pose.arms = .wave
            case .jump:
                pose.motion = .jump
                pose.age = t - Double(latest.tick) * Self.tick
            case .sit:
                pose.motion = .still
                pose.sits = true
            }
        }
        return pose
    }

    /// Nil keeps the current act (a walk then ends).
    private func roll(_ mid: Int, _ n: Int) -> Act? {
        guard unit(mid, n, 0) >= 0.45 else { return nil }
        let r = unit(mid, n, 1)
        if r < 0.5 { return .walk }
        if r < 0.68 { return .wave }
        if r < 0.84 { return .jump }
        return .sit
    }

    private func spot(_ mid: Int, _ n: Int) -> CGPoint {
        CGPoint(x: unit(mid, n, 2), y: unit(mid, n, 3))
    }

    /// A repeatable value in 0..<1 (the splitmix64 finalizer).
    private func unit(_ mid: Int, _ n: Int, _ salt: UInt64) -> Double {
        var z = seed
        z = z &+ UInt64(mid) &* 0x9E37_79B9_7F4A_7C15
        z = z &+ UInt64(n) &* 0xBF58_476D_1CE4_E5B9
        z = z &+ salt &* 0x94D0_49BB_1331_11EB
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        z ^= z >> 31
        return Double(z >> 11) / 9_007_199_254_740_992
    }
}

/// What the three Mids are doing while the verdict is made, one stage per
/// part of the judges' work.
enum JudgingStage: Equatable, Sendable {
    case gather, huddle, lineUp, read, examine, weigh, vote, cheer

    /// The stage for a point of the judging timeline. The story runs once,
    /// then the Mids keep weighing until the verdict is in; the votes show
    /// through the finish steps and the cheer fills the hold after them.
    static func of(_ state: Thinking.DigState, done: Bool, finished: Bool) -> JudgingStage {
        if finished { return .cheer }
        switch state {
        case .finish:
            return .vote
        case .loop(let step, let cycle):
            if done { return .vote }
            if cycle >= 1 { return .weigh }
            switch step {
            case ...0: return .gather
            case 1: return .huddle
            case 2: return .lineUp
            case 3: return .read
            case 4, 5: return .examine
            case 6, 7: return .weigh
            default: return .vote
            }
        }
    }

    /// The flag each Mid raises: its judge's side, nothing for a judge who
    /// has not voted or ruled for neither.
    static func flags(_ dots: [Thinking.Dot]) -> [Party?] {
        dots.map { (dot) -> Party? in
            guard case .vote(let vote) = dot else { return nil }
            switch vote {
            case .a: return .a
            case .b: return .b
            case .other: return nil
            }
        }
    }

    /// The drawing area in points, before it is fitted to the screen.
    static let size = CGSize(width: 340, height: 255)

    private static let middle = 170.0
    private static let row = 130.0

    /// Where the Mids start before the first stage walks them in.
    static let scattered = [CGPoint(x: 55, y: row), CGPoint(x: 170, y: row + 25), CGPoint(x: 285, y: row - 25)]

    var targets: [CGPoint] {
        let c = Self.middle
        let r = Self.row
        switch self {
        case .gather, .huddle:
            return [CGPoint(x: c - 34, y: r - 50), CGPoint(x: c, y: r - 20), CGPoint(x: c + 34, y: r - 50)]
        case .lineUp, .read, .weigh, .vote:
            return [CGPoint(x: c - 110, y: r), CGPoint(x: c, y: r), CGPoint(x: c + 110, y: r)]
        case .examine:
            return [CGPoint(x: c - 118, y: r), CGPoint(x: c, y: r + 36), CGPoint(x: c + 118, y: r)]
        case .cheer:
            return [CGPoint(x: c - 80, y: r - 30), CGPoint(x: c, y: r - 40), CGPoint(x: c + 80, y: r - 30)]
        }
    }

    /// Seconds the walk to this stage's spots takes.
    var walkTime: Double {
        switch self {
        case .gather: return 0.9
        case .huddle: return 0.5
        case .lineUp: return 1
        case .read: return 0.6
        case .examine, .weigh: return 0.8
        case .vote: return 0.5
        case .cheer: return 0.7
        }
    }

    /// `age` is the time since the stage began; `flag` only matters for the vote.
    func pose(_ mid: Int, moving: Bool, age: Double, flag: Party?) -> MidPose {
        var pose = MidPose(motion: .bob, look: CGPoint(x: mid == 2 ? -5 : 5, y: 0), age: age)
        switch self {
        case .gather, .lineUp:
            pose.motion = moving ? .walk : .bob
        case .huddle, .examine:
            pose.motion = .nod
            pose.look = .zero
        case .read:
            pose.motion = .nod
            pose.arms = .hold
            pose.look = CGPoint(x: 0, y: 6)
        case .weigh:
            if mid == 1 { pose.arms = .beam }
        case .vote:
            if let flag {
                pose.arms = .up
                pose.flag = flag
            }
        case .cheer:
            pose.motion = .cheer
            pose.arms = .up
        }
        return pose
    }
}

/// The walk from one stage's spots to the next, started at `since`. Moving
/// on in the middle of a walk starts the new one from where the Mids are.
struct MidsShift: Equatable, Sendable {
    var stage: JudgingStage
    var since: TimeInterval
    var from = JudgingStage.scattered

    func positions(at t: TimeInterval) -> [CGPoint] {
        let e = Curve.stroll.at((t - since) / stage.walkTime)
        return zip(from, stage.targets).map { blend($0, $1, e) }
    }

    func moving(at t: TimeInterval) -> Bool {
        t - since < stage.walkTime
    }

    func moved(to next: JudgingStage, at t: TimeInterval) -> MidsShift {
        MidsShift(stage: next, since: t, from: positions(at: t))
    }
}
