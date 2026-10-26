import Foundation

/// Ports of lib/verdict-display.ts, lib/balance.ts, lib/content-lang.ts and
/// lib/crux-style.ts. Pure functions, covered by the golden vectors in
/// mobile/shared/fixtures/display-vectors.json.
enum VerdictDisplay {
    /// The verdict label ("You're right", "Sam is right", "Split decision").
    /// An unknown verdict from a newer server reads like `too_close`.
    static func label(_ verdict: FinalVerdict, parties: PartyNames, lang: AppLang) -> String {
        switch verdict {
        case .sideA:
            return parties.aIsSelf ? L10n.verdictWinSelf(lang) : L10n.verdictWin(lang, name: parties.nameA)
        case .sideB:
            return parties.bIsSelf ? L10n.verdictWinSelf(lang) : L10n.verdictWin(lang, name: parties.nameB)
        case .split:
            return L10n.verdictSplit(lang)
        case .conditional:
            return L10n.verdictConditional(lang)
        case .dissolved:
            return L10n.verdictDissolved(lang)
        case .tooClose, .unknown:
            return L10n.verdictTooClose(lang)
        }
    }

    /// Party A's share of the tug-of-war bar, in percent: 80/20 for a win,
    /// a fixed 62/38 for a forced-ruling lean, 50 otherwise.
    static func tugFinal(_ result: VerdictResult) -> Int {
        switch result.verdict {
        case .sideA: return 80
        case .sideB: return 20
        default:
            guard let lean = result.lean.value else { return 50 }
            return lean.party == .a ? 62 : 38
        }
    }

    /// What the balance shows: a refusal stays level (the model never judged).
    static func sceneTug(_ result: VerdictResult) -> Int {
        result.modelRefused ? 50 : tugFinal(result)
    }

    /// What the 3D scene settles on (sceneVerdictFrom): a refusal stays
    /// level with no votes.
    static func sceneVerdict(_ result: VerdictResult) -> SceneMode {
        if result.modelRefused { return .verdict(tugA: 50, votes: []) }
        return .verdict(tugA: tugFinal(result), votes: result.runs.map(vote))
    }

    /// Largest verdict tilt in radians (about 17 degrees at 100/0).
    static let maxTiltRadians = 0.3

    /// Beam angle for Party A's share; positive = Party A (left) end down.
    static func tiltRadians(tugA: Int) -> Double {
        let level = max(-1, min(1, Double(tugA - 50) / 50))
        return level * maxTiltRadians
    }

    /// The same tilt as a clockwise-positive rotation (SwiftUI's
    /// `rotationEffect` and `GraphicsContext.rotate`), so the winner's end
    /// goes down: side_a -10.31, side_b +10.31, lean -4.13 / +4.13.
    static func rotationDegrees(tugA: Int) -> Double {
        let degrees = -tiltRadians(tugA: tugA) * 180 / .pi
        return degrees == 0 ? 0 : degrees
    }

    /// Forced-vote split for a non-unanimous lean: the stored tally, else
    /// (runs - 1)-1.
    static func leanTally(_ lean: Lean, runCount: Int) -> LeanTally {
        lean.tally ?? LeanTally(forValue: runCount - 1, against: 1)
    }

    /// "Judges: 2 strong + 1 quick" for a premium panel. Users see seat
    /// tiers, never model names: the lite model is "quick", every other is
    /// "strong".
    static func panelSummary(models: [String], lang: AppLang) -> String {
        let quick = models.filter { $0.lowercased().contains("haiku") }.count
        let strong = models.count - quick
        var parts: [String] = []
        if strong > 0 { parts.append(L10n.panelStrong(lang, n: String(strong))) }
        if quick > 0 { parts.append(L10n.panelQuick(lang, n: String(quick))) }
        return L10n.panelModels(lang, list: parts.joined(separator: " + "))
    }

    /// Raw values are the scene bridge's (lib/scene-bridge.ts Vote).
    enum Vote: String, Sendable, Equatable {
        case a, b, other
    }

    static func vote(_ run: JudgeVerdict) -> Vote {
        switch run {
        case .sideA: return .a
        case .sideB: return .b
        default: return .other
        }
    }

    enum Seal: Sendable, Equatable {
        case a, b, none
    }

    static func seal(_ verdict: FinalVerdict) -> Seal {
        switch verdict {
        case .sideA: return .a
        case .sideB: return .b
        default: return .none
        }
    }

    /// The footnote's votes in words, joined with " · ".
    static func votesText(_ runs: [JudgeVerdict], parties: PartyNames, lang: AppLang) -> String {
        runs.map { run -> String in
            switch run {
            case .sideA: return parties.nameA
            case .sideB: return parties.nameB
            case .split: return L10n.voteSplit(lang)
            case .conditional: return L10n.voteConditional(lang)
            case .dissolved, .unknown: return L10n.voteDissolved(lang)
            }
        }
        .joined(separator: " · ")
    }

    /// "High confidence · 4/5" with the value clamped to 1...5.
    static func confidenceText(_ value: Int, lang: AppLang) -> String {
        let n = clampedConfidence(value)
        let word = L10n.text("confidence.\(n)", lang) ?? ""
        return L10n.confidenceWord(lang, word: word, n: String(n))
    }

    static func clampedConfidence(_ value: Int) -> Int { max(1, min(5, value)) }

    static func badge(_ type: DisputeType, lang: AppLang) -> String? {
        type == .unknown ? nil : L10n.text("badge.\(type.rawValue)", lang)
    }

    static func kind(_ kind: ClaimKind, lang: AppLang) -> String? {
        kind == .unknown ? nil : L10n.text("kind.\(kind.rawValue)", lang)
    }

    /// Labels longer than this stack the seal above them.
    static let stackLabelLength = 12
    /// Labels longer than this use the smaller display size.
    static let longLabelLength = 18
}

enum ContentLang {
    /// Turkish-only letters or the Turkish party label decide it.
    static func of(_ text: String) -> AppLang {
        let turkishLetters: Set<Character> = ["ğ", "ı", "İ", "ş", "Ğ", "Ş"]
        if text.contains(where: { turkishLetters.contains($0) }) { return .tr }
        return containsTurkishLabel(text) ? .tr : .en
    }

    /// `\bTaraf [AB]\b` with JavaScript's ASCII word boundaries.
    private static func containsTurkishLabel(_ text: String) -> Bool {
        let scalars = Array(text.unicodeScalars)
        let needle = Array("Taraf ".unicodeScalars)
        guard scalars.count >= needle.count + 1 else { return false }
        func isWord(_ s: Unicode.Scalar) -> Bool {
            s.isASCII && (s == "_" || s.properties.isAlphabetic || (48...57).contains(s.value))
        }
        for start in 0...(scalars.count - needle.count - 1) {
            guard Array(scalars[start..<(start + needle.count)]) == needle else { continue }
            let letter = scalars[start + needle.count]
            guard letter == "A" || letter == "B" else { continue }
            if start > 0, isWord(scalars[start - 1]) { continue }
            let after = start + needle.count + 1
            if after < scalars.count, isWord(scalars[after]) { continue }
            return true
        }
        return false
    }

    /// The language a verdict's free text is written in: the recorded
    /// `lang`, else the heuristic over the main text fields.
    static func verdictLang(_ result: VerdictResult) -> AppLang {
        if let lang = result.lang { return lang }
        let map = result.argumentMap
        let parts = [result.headline, result.crux, result.losingSideBestPoint, map.bedrockA, map.bedrockB]
            + map.sideA.map(\.claim) + map.sideB.map(\.claim)
        return of(parts.joined(separator: " "))
    }
}

enum CruxStyle: String, Sendable {
    case serif, sans

    /// Longest crux, in code points, still set in the display serif.
    static let serifMax = 180

    static func of(_ text: String) -> CruxStyle {
        let collapsed = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return collapsed.unicodeScalars.count > serifMax ? .sans : .serif
    }
}

/// Port of `conditionalClause` (components/VerdictReveal.tsx): the branch
/// clause after the "If"/"Eğer" prefix. Both markers are stripped in both
/// languages; Turkish lowercases with Turkish rules and keeps the capital of
/// a party label or real name; English lowercases a leading "You"/"Your".
enum ConditionalClause {
    static func format(_ raw: String, lang: AppLang, keep: [String] = []) -> String {
        let text = stripMarker(raw)
        guard let first = text.first else { return text }
        let rest = text.dropFirst()
        if lang == .tr {
            if text.hasPrefix("Taraf") || keep.contains(where: { !$0.isEmpty && text.hasPrefix($0) }) { return text }
            return String(first).lowercased(with: Locale(identifier: "tr")) + rest
        }
        let word = text.prefix { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_") }
        return word == "You" || word == "Your" ? String(first).lowercased() + rest : text
    }

    /// `^(eğer|if)\s+`, case-insensitive.
    private static func stripMarker(_ text: String) -> String {
        guard let space = text.firstIndex(where: { $0.isWhitespace }) else { return text }
        let marker = text[..<space].lowercased(with: Locale(identifier: "tr"))
        let english = text[..<space].lowercased()
        guard marker == "eğer" || english == "if" || english == "eğer" else { return text }
        let afterSpaces = text[space...].drop { $0.isWhitespace }
        return String(afterSpaces)
    }
}

/// The value-framework presets (lib/frameworks.ts). The emoji table is
/// hand-copied and pinned by a test against display-vectors.json.
struct Preset: Sendable, Identifiable, Equatable {
    let id: String
    let emoji: String

    func label(_ lang: AppLang) -> String { L10n.text("preset.\(id).label", lang) ?? id }
    func blurb(_ lang: AppLang) -> String { L10n.text("preset.\(id).blurb", lang) ?? "" }

    static let all: [Preset] = [
        Preset(id: "balanced", emoji: "⚖️"),
        Preset(id: "outcomes", emoji: "🎯"),
        Preset(id: "principles", emoji: "📜"),
        Preset(id: "fairness", emoji: "🤝"),
        Preset(id: "loyalty", emoji: "❤️"),
    ]

    static let defaultID = "balanced"

    static func find(_ id: String) -> Preset { all.first { $0.id == id } ?? all[0] }
}

/// Example chips on Home: the label is shown, the text fills the box.
struct ExampleArgument: Sendable, Identifiable {
    let id: String

    func label(_ lang: AppLang) -> String { L10n.text("example.\(id).label", lang) ?? id }
    func text(_ lang: AppLang) -> String { L10n.text("example.\(id).text", lang) ?? "" }

    static let all: [ExampleArgument] = ["hotdog", "tomato", "whiteLie", "knuckles", "pineapple"].map { ExampleArgument(id: $0) }
}
