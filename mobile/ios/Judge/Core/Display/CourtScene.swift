import Foundation

/// What the bundled court page shows (components/court/engine.ts CourtScene).
enum CourtScene: Sendable, Equatable {
    case home(busy: Bool)
    case judging(Story.Beat, Story.Summary?)

    /// The argument of `window.judgeCourt.set`.
    var json: String {
        switch self {
        case .home(let busy):
            return #"{"kind":"home","busy":\#(busy)}"#
        case .judging(let beat, let summary):
            func quoted(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
            let votes = (summary?.votes ?? []).map { quoted($0.rawValue) }.joined(separator: ",")
            let winner = quoted(summary?.winner?.rawValue)
            let trial = quoted(summary?.trial?.rawValue)
            return #"{"kind":"judging","beat":"\#(beat.rawValue)","votes":[\#(votes)],"extra":\#(summary?.extra ?? 0),"winner":\#(winner),"trial":\#(trial)}"#
        }
    }
}
