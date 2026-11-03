import Foundation

/// Display names for the two parties (the label half of lib/names.ts).
struct PartyNames: Sendable, Equatable {
    let nameA: String
    let nameB: String
    /// Structural second-person flags: never detect "you" by comparing names.
    let aIsSelf: Bool
    let bIsSelf: Bool

    func name(_ party: Party) -> String { party == .a ? nameA : nameB }
    func isSelf(_ party: Party) -> Bool { party == .a ? aIsSelf : bIsSelf }
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
    /// that is not a person label.
    static func canonicalLabel(_ replacement: String) -> String? {
        let text = replacement.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = #/^(?:(?:party|taraf)\s+([ab])|(?:person|kişi)\s+([c-z]))(?:['’]\p{L}*)?$/#.ignoresCase()
        guard let match = text.wholeMatch(of: pattern) else { return nil }
        if let party = match.output.1 { return "Party \(party.uppercased())" }
        if let person = match.output.2 { return "Person \(person.uppercased())" }
        return nil
    }

    private static func labelLetter(_ replacement: String) -> String? {
        canonicalLabel(replacement).flatMap { $0.last.map(String.init) }
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
    static func resolveParties(_ nameMap: [NameMapping], selfLang: AppLang, selfParty: String = "A") -> [String: Resolved] {
        var parties: [String: Resolved] = [:]
        for mapping in nameMap {
            guard let letter = labelLetter(mapping.replacement) else { continue }
            let name = bareName(mapping.original)
            guard !name.isEmpty else { continue }
            let current = parties[letter]
            if letter == selfParty, isSelfOriginal(name, selfLang: selfLang) {
                parties[letter] = Resolved(name: name, isSelf: true)
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
    static func partyNames(_ nameMap: [NameMapping], lang: AppLang, selfLang: AppLang) -> PartyNames {
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
