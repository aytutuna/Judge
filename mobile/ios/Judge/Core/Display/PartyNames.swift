import Foundation

extension Party {
    /// "Party C" in the app's language; empty for a party this build does not know.
    func label(_ lang: AppLang) -> String {
        switch self {
        case .a: return L10n.partyA(lang)
        case .b: return L10n.partyB(lang)
        case .c: return L10n.partyC(lang)
        case .d: return L10n.partyD(lang)
        case .unknown: return ""
        }
    }
}

/// Display names for the parties (the label half of lib/names.ts). C and D
/// are only read on verdicts with more than two sides.
struct PartyNames: Sendable, Equatable {
    let nameA: String
    let nameB: String
    let nameC: String
    let nameD: String
    /// Structural second-person flags: never detect "you" by comparing names.
    let aIsSelf: Bool
    let bIsSelf: Bool
    let cIsSelf: Bool
    let dIsSelf: Bool

    init(
        nameA: String, nameB: String, nameC: String = "", nameD: String = "",
        aIsSelf: Bool, bIsSelf: Bool, cIsSelf: Bool = false, dIsSelf: Bool = false
    ) {
        self.nameA = nameA
        self.nameB = nameB
        self.nameC = nameC
        self.nameD = nameD
        self.aIsSelf = aIsSelf
        self.bIsSelf = bIsSelf
        self.cIsSelf = cIsSelf
        self.dIsSelf = dIsSelf
    }

    func name(_ party: Party) -> String {
        switch party {
        case .a: return nameA
        case .c: return nameC
        case .d: return nameD
        case .b, .unknown: return nameB
        }
    }

    func isSelf(_ party: Party) -> Bool {
        switch party {
        case .a: return aIsSelf
        case .c: return cIsSelf
        case .d: return dIsSelf
        case .b, .unknown: return bIsSelf
        }
    }
}

/// Port of the label half of lib/names.ts: canonicalLabel, bareName,
/// resolveParties and partyNames. Putting real names back into the verdict
/// text (restoreNames, personalizeResult) lives in RestoreNames.swift.
enum Names {
    /// Turkish first-person forms, compared after Turkish lowercasing.
    static let trSelf: Set<String> = [
        "ben", "bence", "benim", "bana", "beni", "bende", "benden", "benimle",
        "bendeki", "benimki", "kendim", "kendime", "kendimi", "kendimden",
    ]

    static let enSelf: Set<String> = ["i", "me", "my", "mine", "myself"]

    private static let trLocale = Locale(identifier: "tr")
    private static let enLocale = Locale(identifier: "en")

    struct Resolved: Sendable, Equatable {
        let name: String
        let isSelf: Bool
    }

    /// "taraf b'ye" -> "Party B", "Kişi C" -> "Person C"; nil for anything
    /// that is not a person label. `sides` is how many sides the document
    /// has: only one with more than two reads "Party C" and "Party D" as
    /// sides, and other people then start at Person E.
    static func canonicalLabel(_ replacement: String, sides: Int = 2) -> String? {
        let text = replacement.trimmingCharacters(in: .whitespacesAndNewlines)
        let party: Substring?
        let person: Substring?
        if sides > 2 {
            let pattern = #/^(?:(?:party|taraf)\s+([a-d])|(?:person|kişi)\s+([e-z]))(?:['’]\p{L}*)?$/#.ignoresCase()
            guard let found = text.wholeMatch(of: pattern) else { return nil }
            party = found.output.1
            person = found.output.2
        } else {
            let pattern = #/^(?:(?:party|taraf)\s+([ab])|(?:person|kişi)\s+([c-z]))(?:['’]\p{L}*)?$/#.ignoresCase()
            guard let found = text.wholeMatch(of: pattern) else { return nil }
            party = found.output.1
            person = found.output.2
        }
        if let party {
            if sides > 2, party.uppercased() > lastSide(sides) { return nil }
            return "Party \(party.uppercased())"
        }
        if let person { return "Person \(person.uppercased())" }
        return nil
    }

    /// The letter of the last side of a document ("B", "C" or "D").
    static func lastSide(_ sides: Int) -> String {
        String(UnicodeScalar(UInt8(64 + min(max(sides, 2), 4))))
    }

    private static func labelLetter(_ replacement: String, sides: Int = 2) -> String? {
        canonicalLabel(replacement, sides: sides).flatMap { $0.last.map(String.init) }
    }

    /// A name minus a Turkish case suffix or English possessive after an
    /// apostrophe ("Deniz'in", "Mark's" -> "Deniz", "Mark"). "O'Brien" stays
    /// whole (a suffix is lowercase); a one-letter base is never cut.
    static func bareName(_ original: String) -> String {
        let quotes: Set<Character> = ["\"", "“", "”", "«", "»"]
        var text = original.trimmingCharacters(in: .whitespacesAndNewlines)
        while let first = text.first, quotes.contains(first) { text.removeFirst() }
        while let last = text.last, quotes.contains(last) { text.removeLast() }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = #/^(.*\p{L}.*\p{L}|\p{L}{2,})['’]\p{Ll}{1,10}$/#
        if let match = text.wholeMatch(of: pattern) { return String(match.output.1) }
        return text
    }

    private static func isSelfOriginal(_ original: String, selfLang: AppLang) -> Bool {
        if enSelf.contains(original.lowercased(with: enLocale)) { return true }
        return selfLang == .tr && trSelf.contains(original.lowercased(with: trLocale))
    }

    private static func startsUpper(_ text: String) -> Bool {
        text.unicodeScalars.first?.properties.generalCategory == .uppercaseLetter
    }

    /// Who each label letter stands for. The pronoun -> narrator rule applies
    /// only to the narrator's slot, `selfParty` (the anonymizer puts a
    /// first-person writer in A; the side that answered a case is B), and the
    /// Turkish forms only when the argument was judged in Turkish. For names,
    /// a capitalized entry beats a lowercase description.
    static func resolveParties(_ nameMap: [NameMapping], selfLang: AppLang, selfParty: String = "A", sides: Int = 2) -> [String: Resolved] {
        var parties: [String: Resolved] = [:]
        let last = lastSide(sides)
        for mapping in nameMap {
            guard let letter = labelLetter(mapping.replacement, sides: sides) else { continue }
            let name = bareName(mapping.original)
            guard !name.isEmpty else { continue }
            let current = parties[letter]
            if letter == selfParty, isSelfOriginal(name, selfLang: selfLang) {
                parties[letter] = Resolved(name: name, isSelf: true)
            } else if letter > last, isSelfOriginal(name, selfLang: selfLang) {
                // A first-person word never names someone who is not a side.
                continue
            } else if let current {
                if !current.isSelf, !startsUpper(current.name), startsUpper(name) {
                    parties[letter] = Resolved(name: name, isSelf: false)
                }
            } else {
                parties[letter] = Resolved(name: name, isSelf: false)
            }
        }
        return parties
    }

    /// Labels follow `lang` (the UI language); narrator detection follows
    /// `selfLang` (the language the argument was judged in).
    static func partyNames(_ nameMap: [NameMapping], lang: AppLang, selfLang: AppLang, sides: Int = 2) -> PartyNames {
        if sides > 2 {
            return partyNamesFor(Party.sides(sides), nameMap, lang: lang, selfLang: selfLang)
        }
        let parties = resolveParties(nameMap, selfLang: selfLang)
        let a = parties["A"]
        let b = parties["B"]
        let nameA: String
        if let a {
            nameA = a.isSelf ? L10n.you(lang) : a.name
        } else {
            nameA = L10n.partyA(lang)
        }
        return PartyNames(
            nameA: nameA,
            nameB: b?.name ?? L10n.partyB(lang),
            aIsSelf: a?.isSelf ?? false,
            bIsSelf: false
        )
    }

    /// Display names for a verdict with three or four sides (partyNamesFor in
    /// lib/names.ts). The narrator's entry makes `selfParty` "you"; a side the
    /// map says nothing about shows its label, and with `viewerKnown` the
    /// viewer's own reads "Party C (you)".
    static func partyNamesFor(
        _ sides: [Party], _ nameMap: [NameMapping], lang: AppLang, selfLang: AppLang,
        selfParty: String = "A", viewerKnown: Bool = false
    ) -> PartyNames {
        let resolved = resolveParties(nameMap, selfLang: selfLang, selfParty: selfParty, sides: sides.count)
        let word = String(L10n.partyA(lang).dropLast())
        func entry(_ party: Party) -> (name: String, isSelf: Bool) {
            guard sides.contains(party) else { return ("", false) }
            let letter = party.letter
            let label = word + letter
            if let found = resolved[letter] { return (found.isSelf ? L10n.you(lang) : found.name, found.isSelf) }
            if viewerKnown, selfParty == letter { return (L10n.partyYouLabel(lang, label: label), true) }
            return (label, false)
        }
        let a = entry(.a), b = entry(.b), c = entry(.c), d = entry(.d)
        return PartyNames(
            nameA: a.name, nameB: b.name, nameC: c.name, nameD: d.name,
            aIsSelf: a.isSelf, bIsSelf: b.isSelf, cIsSelf: c.isSelf, dIsSelf: d.isSelf
        )
    }

    /// firstNameOf (lib/originals-types.ts): the bare name's first word when
    /// it reads as a first name (a capital, then 1 to 39 letters, apostrophes
    /// or hyphens); descriptions, usernames and pronouns give nil.
    static func firstName(_ name: String?) -> String? {
        guard let name, !name.isEmpty else { return nil }
        let first = bareName(name).trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace }).first.map(String.init) ?? ""
        if enSelf.contains(first.lowercased(with: enLocale)) { return nil }
        return first.wholeMatch(of: #/\p{Lu}[\p{L}'’-]{1,39}/#) == nil ? nil : first
    }
}
