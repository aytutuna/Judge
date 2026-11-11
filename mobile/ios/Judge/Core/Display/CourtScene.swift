import Foundation

/// What the bundled court page shows (components/court/engine.ts CourtScene).
/// `venue` is one of the ids in `Venues`; the page draws the court for any
/// other.
enum CourtScene: Sendable, Equatable {
    case home(busy: Bool, venue: String = Venues.fallback)
    /// `sides` is how many stand at centre court before the verdict says.
    case judging(Story.Beat, Story.Summary?, sides: Int = 2, venue: String = Venues.fallback)

    /// The argument of `window.judgeCourt.set`.
    var json: String {
        switch self {
        case .home(let busy, let venue):
            return #"{"kind":"home","venue":"\#(venue)","busy":\#(busy)}"#
        case .judging(let beat, let summary, let judged, let venue):
            func quoted(_ value: String?) -> String { value.map { "\"\($0)\"" } ?? "null" }
            let votes = (summary?.votes ?? []).map { quoted($0.rawValue) }.joined(separator: ",")
            let winner = quoted(summary?.winner?.rawValue)
            let trial = quoted(summary?.trial?.rawValue)
            // Two sides are the default and stay as they were.
            let count = max(judged, summary?.sides ?? 2)
            let sides = count > 2 ? #","sides":\#(count)"# : ""
            return #"{"kind":"judging","venue":"\#(venue)","beat":"\#(beat.rawValue)","votes":[\#(votes)],"extra":\#(summary?.extra ?? 0),"winner":\#(winner),"trial":\#(trial)\#(sides)}"#
        }
    }
}
