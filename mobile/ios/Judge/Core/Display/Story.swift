import Foundation

/// Port of components/court/story.ts: what the judging card says and shows
/// while it waits, and the fixed plan for the moments after the verdict
/// lands. Checked against mobile/shared/fixtures/story-vectors.json.
enum Story {
    enum Beat: String, Sendable, Equatable, Hashable {
        case names, facts, judges, bothSides, crux, ruling
        case vote1, more, vote2, trial
        /// "final" on the wire.
        case finale = "final"
    }

    static let waiting: [Beat] = [.names, .facts, .judges, .bothSides, .crux, .ruling]

    /// Names stay up at least this long, so the first line can be read.
    static let namesMinMs = 2500
    static let catchUpMs = 450
    static let voteMs = 420
    /// The cross-examination: objection, then the adjudicator's answer.
    static let trialMs = 4200
    /// The longest the card plays on after the verdict lands.
    static let endingMaxMs = 16000

    /// How long each waiting line holds once the names are out; the last one
    /// waits for the verdict however long it takes.
    private static let holds: [Beat: Double] = [.facts: 9000, .judges: 6000, .bothSides: 7000, .crux: 7000]

    /// The waiting line being worked on `elapsed` ms in, given when the
    /// request was accepted (nil: not yet).
    static func waitingAt(_ elapsed: Double, acceptedAt: Double?) -> Int {
        guard let acceptedAt else { return 0 }
        var t = max(Double(namesMinMs), acceptedAt)
        if elapsed < t { return 0 }
        for i in 1..<(waiting.count - 1) {
            t += holds[waiting[i]] ?? 0
            if elapsed < t { return i }
        }
        return waiting.count - 1
    }

    /// The most common vote and how many judges gave it; no side unless it
    /// is more than half.
    static func agreement(_ votes: [VerdictDisplay.Vote]) -> (side: VerdictDisplay.Vote?, n: Int) {
        var order: [VerdictDisplay.Vote] = []
        var counts: [VerdictDisplay.Vote: Int] = [:]
        for vote in votes {
            if counts[vote] == nil { order.append(vote) }
            counts[vote, default: 0] += 1
        }
        var side: VerdictDisplay.Vote?
        var n = 0
        for vote in order {
            let count = counts[vote] ?? 0
            if count > n {
                side = vote
                n = count
            } else if count == n {
                side = nil
            }
        }
        return (n * 2 > votes.count ? side : nil, n)
    }

    /// What the ending needs to know about the verdict.
    struct Summary: Sendable, Equatable {
        var votes: [VerdictDisplay.Vote]
        var escalated: Bool
        /// Judges called in for a close one; the first round is the usual three.
        var extra: Int
        var winner: Party?
        var trial: CruxTrialOutcome?
        /// How many sides stand at centre court.
        var sides = 2
    }

    static func summarize(_ result: VerdictResult) -> Summary {
        let votes = result.modelRefused ? [] : (result.isMany ? (result.votes ?? []) : result.runs.map { VerdictDisplay.vote($0) })
        let escalated = result.escalated
        let winner: Party?
        if result.isMany {
            winner = result.winner
        } else {
            switch result.verdict {
            case .sideA: winner = .a
            case .sideB: winner = .b
            default: winner = nil
            }
        }
        let trial = result.cruxTrial?.outcome
        return Summary(
            votes: votes,
            escalated: escalated,
            extra: escalated ? max(0, votes.count - 3) : 0,
            winner: winner,
            trial: trial == .unknown ? nil : trial,
            sides: result.sideCount
        )
    }

    /// A log line: the key of its text and, for the agreement count, its slots.
    struct Line: Sendable, Equatable {
        struct Vars: Sendable, Equatable {
            let n: Int
            let total: Int
        }

        let key: String
        var vars: Vars? = nil
    }

    /// At `at` ms after the verdict lands, the court moves to `beat` and the
    /// log gains `line` (if any).
    struct Step: Sendable, Equatable {
        let at: Int
        let beat: Beat
        let line: Line?
    }

    struct Ending: Sendable, Equatable {
        let steps: [Step]
        let finishAt: Int
    }

    /// Everything that happens once the verdict lands, given the waiting line
    /// the story was on. Without a summary (no result) or with reduced
    /// motion the card just hands off.
    static func ending(fromWaiting: Int, summary: Summary?, reduced: Bool) -> Ending {
        guard !reduced, let summary else { return Ending(steps: [], finishAt: reduced ? 600 : 0) }
        let votes = summary.votes
        var steps: [Step] = []
        var at = 0
        func later(_ ms: Int, _ beat: Beat, _ line: Line?) {
            at += ms
            steps.append(Step(at: at, beat: beat, line: line))
        }
        for i in stride(from: fromWaiting + 1, to: waiting.count, by: 1) {
            later(i == fromWaiting + 1 ? 0 : catchUpMs, waiting[i], Line(key: "story.\(waiting[i].rawValue)"))
        }
        // A refusal has no votes to count, so it skips straight to the end.
        if !votes.isEmpty {
            later(catchUpMs, .vote1, Line(key: "story.count"))
            at += 1200 + min(3, votes.count) * voteMs
        }
        if summary.escalated {
            later(400, .more, Line(key: "story.closeCall"))
            if summary.extra > 0 {
                later(2600, .vote2, nil)
                at += min(2, summary.extra) * voteMs
            }
        }
        if !votes.isEmpty, let trial = summary.trial {
            later(600, .trial, Line(key: "trial.\(trial.rawValue)"))
            at += trialMs
        }
        let agreed = agreement(votes)
        at += 600
        if !votes.isEmpty {
            let line = agreed.side != nil
                ? Line(key: "story.agree", vars: Line.Vars(n: agreed.n, total: votes.count))
                : Line(key: "story.split")
            steps.append(Step(at: at, beat: .finale, line: line))
        }
        steps.append(Step(at: at, beat: .finale, line: Line(key: "thinking.ready")))
        return Ending(steps: steps, finishAt: at + 1900)
    }

    /// The text of a log line in the app's language. The trial lines come
    /// without their leading emoji; a doubtful one carries its reason and,
    /// for a mixed dispute, the mixed note.
    static func text(_ line: Line, lang: AppLang, result: VerdictResult? = nil) -> String {
        switch line.key {
        case "story.names": return L10n.storyNames(lang)
        case "story.facts": return L10n.storyFacts(lang)
        case "story.judges": return L10n.storyJudges(lang)
        case "story.bothSides": return L10n.storyBothSides(lang)
        case "story.crux": return L10n.storyCrux(lang)
        case "story.ruling": return L10n.storyRuling(lang)
        case "story.count": return L10n.storyCount(lang)
        case "story.closeCall": return L10n.storyCloseCall(lang)
        case "story.agree": return L10n.storyAgree(lang, n: String(line.vars?.n ?? 0), total: String(line.vars?.total ?? 0))
        case "story.split": return L10n.storySplit(lang)
        case "trial.survived": return stripLeadingEmoji(L10n.trialSurvived(lang))
        case "trial.minor": return doubt(stripLeadingEmoji(L10n.trialMinor(lang)), result, lang, mixedNote: false)
        case "trial.uncertain": return doubt(stripLeadingEmoji(L10n.trialUncertain(lang)), result, lang)
        case "trial.overturned": return doubt(stripLeadingEmoji(L10n.trialOverturned(lang)), result, lang)
        case "thinking.ready": return L10n.thinkingReady(lang)
        default: return ""
        }
    }

    private static func doubt(_ line: String, _ result: VerdictResult?, _ lang: AppLang, mixedNote: Bool = true) -> String {
        guard let trial = result?.cruxTrial else { return line }
        let why = VerdictDisplay.trialWhy(trial)
        let mixed = mixedNote && result?.disputeType == .mixed ? " " + L10n.trialMixedNote(lang) : ""
        return line + (why.isEmpty ? "" : ": " + why) + mixed
    }

    /// Drops a decorative leading emoji and the space after it (lib/text.ts
    /// stripLeadingEmoji); text without one comes back unchanged.
    static func stripLeadingEmoji(_ text: String) -> String {
        let scalars = text.unicodeScalars
        var index = scalars.startIndex
        while index < scalars.endIndex {
            let scalar = scalars[index]
            let decoration = (scalar.value > 0x7F && scalar.properties.isEmoji)
                || scalar.value == 0xFE0F || scalar.value == 0x200D || scalar.value == 0x20E3 || scalar.value == 0x2713
            guard decoration else { break }
            index = scalars.index(after: index)
        }
        guard index != scalars.startIndex else { return text }
        while index < scalars.endIndex, scalars[index].properties.isWhitespace {
            index = scalars.index(after: index)
        }
        return String(String.UnicodeScalarView(scalars[index...]))
    }
}
