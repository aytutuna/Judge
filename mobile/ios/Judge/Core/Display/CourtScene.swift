import Foundation

/// What the bundled court page shows (components/court/engine.ts CourtScene).
enum CourtScene: Sendable, Equatable {
    case home(busy: Bool)
    /// `sides` is how many stand at centre court before the verdict says.
    case judging(Story.Beat, Story.Summary?, sides: Int = 2)

    /// The argument of `window.judgeCourt.set`.
    var json: String {
        switch self {
        case .home(let busy):
            return #"{"kind":"home","busy":\#(busy)}"#
        case .judging(let beat, let summary, let judged):
            func quoted(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
            let votes = (summary?.votes ?? []).map { quoted($0.rawValue) }.joined(separator: ",")
            let winner = quoted(summary?.winner?.rawValue)
            let trial = quoted(summary?.trial?.rawValue)
            // Two sides are the default and stay as they were.
            let count = max(judged, summary?.sides ?? 2)
            let sides = count > 2 ? #","sides":\#(count)"# : ""
            return #"{"kind":"judging","beat":"\#(beat.rawValue)","votes":[\#(votes)],"extra":\#(summary?.extra ?? 0),"winner":\#(winner),"trial":\#(trial)\#(sides)}"#
        }
    }
}
