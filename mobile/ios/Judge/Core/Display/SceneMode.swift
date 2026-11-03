import Foundation

/// The 3D balance's beat while the judges work (lib/scene-bridge.ts JudgingBeat).
enum SceneBeat: String, Sendable {
    case lift, sort, dig, crux, orbs, deliberate
}

/// What the bundled balance scene shows (lib/scene-bridge.ts SceneMode).
enum SceneMode: Sendable, Equatable {
    case judging(SceneBeat)
    case verdict(tugA: Int, votes: [VerdictDisplay.Vote])

    /// The argument of `window.judgeScene.setMode`.
    var json: String {
        switch self {
        case .judging(let beat):
            return #"{"kind":"judging","beat":"\#(beat.rawValue)"}"#
        case .verdict(let tugA, let votes):
            let list = votes.map { "\"\($0.rawValue)\"" }.joined(separator: ",")
            return #"{"kind":"verdict","verdict":{"tugA":\#(tugA),"votes":[\#(list)]}}"#
        }
    }

    /// The flat balance's beam angle: level while judging, the verdict tilt after.
    var fallbackAngle: Double {
        switch self {
        case .judging: return 0
        case .verdict(let tugA, _): return VerdictDisplay.rotationDegrees(tugA: tugA)
        }
    }
}
