import Foundation

/// Port of the text half of lib/names.ts: trSuffix, restoreNames and
/// personalizeResult. Display-only: anything shared, the stored history row
/// and cached translations stay anonymized. All index math runs on UTF-16
/// offsets (NSString), as in JavaScript, so `before`/`after`/`consumed`
/// line up with the web.
extension Names {
    // MARK: Turkish suffixes on a name

    enum TrCase: Sendable, Equatable {
        case gen, genki, acc, dat, loc, locki, abl, ins, cop, past, ken, evid
    }

    /// A suffix after a label's apostrophe, as the judge wrote it for the
    /// letter name ("A'nın", "B'ye"), read back as a grammatical case.
    private static let trCases: [(JSPattern, TrCase)] = [
        (JSPattern(#"^n?[ıiuü]nki\z"#), .genki),
        (JSPattern(#"^n?[ıiuü]n\z"#), .gen),
        (JSPattern(#"^y?[ıiuü]\z"#), .acc),
        (JSPattern(#"^y?[ae]\z"#), .dat),
        (JSPattern(#"^[dt][ae]ki\z"#), .locki),
        (JSPattern(#"^[dt][ae]n\z"#), .abl),
        (JSPattern(#"^[dt][ae]\z"#), .loc),
        (JSPattern(#"^y?l[ae]\z"#), .ins),
        (JSPattern(#"^[dt][ıiuü]r\z"#), .cop),
        (JSPattern(#"^y?[dt][ıiuü]\z"#), .past),
        (JSPattern(#"^y?ken\z"#), .ken),
        (JSPattern(#"^y?m[ıiuü]ş\z"#), .evid),
    ]

    private static func classifyTr(_ suffix: String) -> TrCase? {
        let s = suffix.lowercased(with: turkishLocale)
        for (pattern, trCase) in trCases where pattern.test(s) { return trCase }
        return nil
    }

    private static let vowels = "aeıioöuüâîû"
    private static func isVowel(_ ch: Unicode.Scalar) -> Bool { vowels.unicodeScalars.contains(ch) }
    /// Voiceless consonants: a following d of the locative/ablative/copula turns t.
    private static let voiceless = "fstkçşhp"

    /// Names whose final "l" is palatal, so suffixes take front vowels
    /// despite a back last vowel ("Kemal'in", not "Kemal'ın").
    private static let palatalL: Set<String> = ["kemal", "cemal", "celal", "hilal", "bilal", "nihal", "meral", "hayal", "celâl", "kemâl"]

    /// The Turkish suffix for `name` in case `c`: vowel harmony on the last
    /// vowel, a buffer consonant after a final vowel, d -> t after a
    /// voiceless consonant. Proper names keep their final consonant
    /// (Burak'a). Nil when the name has no vowel ("JJ"): keep the label.
    static func trSuffix(_ name: String, _ c: TrCase) -> String? {
        let lower = jsTrim(name).lowercased(with: turkishLocale)
        let letters = lower.unicodeScalars.filter(isLetter)
        guard let last = letters.last else { return nil }
        guard var v = letters.reversed().first(where: isVowel) else { return nil }
        let lastWord = lower.components(separatedBy: jsWhitespace).last ?? lower
        if palatalL.contains(lastWord) { v = "e" }
        let back = "aıouâû".unicodeScalars.contains(v)
        let a2 = back ? "a" : "e"
        let i4 = "aıâ".unicodeScalars.contains(v) ? "ı"
            : "eiî".unicodeScalars.contains(v) ? "i"
            : "ouû".unicodeScalars.contains(v) ? "u" : "ü"
        let endV = isVowel(last)
        let d = voiceless.unicodeScalars.contains(last) ? "t" : "d"
        let y = endV ? "y" : ""
        switch c {
        case .gen: return (endV ? "n" : "") + i4 + "n"
        case .genki: return (endV ? "n" : "") + i4 + "nki"
        case .acc: return y + i4
        case .dat: return y + a2
        case .loc: return d + a2
        case .locki: return d + a2 + "ki"
        case .abl: return d + a2 + "n"
        case .ins: return y + "l" + a2
        case .cop: return d + i4 + "r"
        case .past: return endV ? "yd" + i4 : d + i4
        case .ken: return y + "ken"
        case .evid: return y + "m" + i4 + "ş"
        }
    }

    // MARK: Restoring names in verdict text

    /// A label in running text, with an optional suffix after an apostrophe.
    /// Both languages' labels are recognised in both languages.
    private static let labelInText = JSPattern(#"(?<![\p{L}\p{N}])(Party|Taraf|Person|Kişi) ([A-Z])(?:(['’])(\p{Ll}+))?(?![\p{L}\p{N}])"#)

    private static let openers = JSPattern(#"["“”‘'«(\[]+\z"#)
    private static let sentenceEnd = JSPattern(#"[.!?…]["”’»)]*\z"#)

    /// Whether the text before a position ends a sentence (or is empty).
    private static func atSentenceStart(_ before: String) -> Bool {
        let b = jsTrimEnd(openers.replaceFirst(in: before, with: ""))
        return b.isEmpty || sentenceEnd.test(b)
    }

    private static func capitalize(_ s: String, _ lang: AppLang) -> String {
        let text = s as NSString
        guard text.length > 0 else { return s }
        return text.substring(to: 1).uppercased(with: lang == .tr ? turkishLocale : englishLocale) + text.substring(from: 1)
    }

    // English narrator: "you", with the verb right after it agreeing.

    private static let enBeHave: [String: String] = ["is": "are", "was": "were", "has": "have", "does": "do"]

    /// Words right after a subject that need no agreement: modals and pasts.
    private static let enNeutralNext: Set<String> = [
        "can", "cannot", "could", "will", "would", "should", "might", "must", "may", "shall",
        "did", "had", "said", "told", "made", "took", "got", "saw", "knew", "thought", "felt", "left",
        "paid", "spent", "kept", "held", "went", "came", "gave", "put", "ran", "won", "lost", "meant",
        "chose", "forgot", "understood", "bought", "brought", "sent", "wrote", "began", "let", "set",
        // Already plural: only reachable when the label is half of "X and Party A".
        "are", "were", "have", "do", "and", "or",
    ]

    /// The same, before "n't".
    private static let enNeutralNeg: Set<String> = [
        "ca", "wo", "could", "would", "should", "might", "must", "did", "had", "are", "were", "have", "do",
    ]

    /// Words right after a label that make it an object: a determiner never
    /// follows a subject ("Party B owes Party A an apology").
    private static let enObjectNext: Set<String> = [
        "a", "an", "the", "some", "any", "no", "this", "that", "these", "those", "his", "her", "their",
        "its", "our", "lots", "nothing", "something", "anything", "everything",
    ]

    /// Words before a label that make it the subject of what follows.
    private static let enSubjectIntro: Set<String> = [
        "and", "but", "or", "because", "since", "while", "whereas", "although", "though", "if", "when",
        "unless", "that", "so", "until", "whether", "where", "what", "who", "which", "once", "than",
        "says", "said", "thinks", "thought", "believes", "believed", "argues", "argued", "claims",
        "claimed", "feels", "felt", "insists", "insisted", "admits", "admitted", "knows", "knew",
        "assumes", "assumed", "expects", "expected", "means", "shows", "suggests", "both", "either",
    ]

    /// Words before a label that make it an object: no verb follows it.
    private static let enPrepositions: Set<String> = [
        "to", "for", "with", "about", "of", "from", "at", "on", "by", "against", "toward", "towards",
        "like", "unlike", "over", "behind", "without", "within", "into", "onto", "upon", "under",
        "around", "near", "beside", "via", "per", "between", "among",
    ]

    /// Common verbs whose -s form is safe to lower to "you" + base form even
    /// in an object-looking slot ("the thing Party A wants").
    private static let enCommonVerbs = Set([
        "want", "think", "say", "claim", "argue", "believe", "feel", "know", "need", "agree", "insist",
        "admit", "win", "lose", "make", "take", "get", "see", "expect", "assume", "care", "prefer",
        "mean", "try", "deserve", "point", "focus", "rely", "ignore", "refuse", "accept", "seem",
        "value", "keep", "treat", "hold", "notice", "mention", "suggest", "show", "prove", "ask",
        "promise", "plan", "choose", "decide", "understand", "remember", "forget", "worry", "help",
        "pay", "spend", "leave", "stay", "work", "call", "use", "count", "describe", "consider",
        "wish", "hope", "like", "love", "hate", "do", "go", "have", "stop", "start", "miss", "owe",
        "blame", "lie", "win", "deny", "admit", "apologize", "apologise", "complain", "object",
    ])

    /// -s words that are never a third-person verb after a subject.
    private static let enNotVerbs: Set<String> = [
        "always", "perhaps", "sometimes", "nevertheless", "towards", "its", "this", "his", "hers",
        "yours", "unless", "whereas", "across", "plus", "thus", "versus", "yes", "besides",
        "afterwards", "nowadays", "regardless", "less", "was", "is", "has", "does", "as",
        "himself", "herself", "itself", "themselves", "ourselves", "yourselves", "nonetheless",
    ]

    private static let enEsEnding = JSPattern(#"(?:ss|sh|ch|x|zz|o)es\z"#)
    private static let enNotSEnding = JSPattern(#"(?:ss|us|is|as|os|'s|’s)\z"#)

    /// Base form of a third-person -s verb, or nil when the word is not one.
    private static func enBaseForm(_ word: String) -> String? {
        let w = word.lowercased()
        let length = (w as NSString).length
        if length < 3 || enNotVerbs.contains(w) || !w.hasSuffix("s") { return nil }
        if w == "goes" { return "go" }
        if w == "focuses" { return "focus" }
        if w.hasSuffix("ies") { return length > 4 ? jsSlice(w, 0, -3) + "y" : jsSlice(w, 0, -1) }
        if enEsEnding.test(w) { return jsSlice(w, 0, -2) }
        if enNotSEnding.test(w) { return nil }
        return jsSlice(w, 0, -1)
    }

    /// A known verb's third-person form ("wants", "tries"), as its base form.
    private static func enKnownVerb(_ word: String) -> String? {
        guard let base = enBaseForm(word), enCommonVerbs.contains(base) else { return nil }
        return base
    }

    private static let prevWordPattern = JSPattern(#"([A-Za-z]+)\s*\z"#)

    private static func prevWord(_ before: String) -> String {
        let text = before as NSString
        guard let m = prevWordPattern.exec(text), let word = m.group(1, in: text) else { return "" }
        return word.lowercased()
    }

    private static let verbEnding = JSPattern(#"(?:s|ed)\z"#)

    /// Whether a word before a label is probably a verb, making the label its
    /// object, so a following -s word may be a plural noun ("gives Party A
    /// points").
    private static func enVerbLike(_ word: String) -> Bool {
        verbEnding.test(word) || enNeutralNext.contains(word) || enCommonVerbs.contains(word)
    }

    private static let enClauseEnds = JSPattern(#"^\s*(?:[.!?…"”’)\]]|\z)"#)
    private static let enNextWord = JSPattern(#"^( )([A-Za-z]+?)(n['’]t)?(?![\p{L}\p{N}'’\-])"#)
    private static let enJoined = JSPattern(#"^\s+(?:and|or|but)\s+([A-Za-z]+?)(?:n['’]t)?(?![\p{L}'’])"#)
    private static let enPast = JSPattern(#"^[a-z]{3,}ed\z"#)
    private static let enEed = JSPattern(#"eed\z"#)
    private static let enSubjectEnd = JSPattern(#"[.!?;:,(—–"“]\z"#)

    /// "you" for an English narrator plus how much of `after` it rewrote, or
    /// nil to keep the label. Only the word immediately after the label is
    /// looked at; anything that does not settle the sentence shape keeps the
    /// label, which reads better than "you is" or "you pays".
    private static func enNarrator(before: String, after: String) -> Rendered? {
        let prev = prevWord(before)
        // An object of a preposition: nothing after it agrees with it.
        if enPrepositions.contains(prev) { return Rendered(text: "you", consumed: 0) }
        // Nothing after the label, or the sentence (or a quote) ends right there.
        if enClauseEnds.test(after) { return Rendered(text: "you", consumed: 0) }
        let text = after as NSString
        guard let m = enNextWord.exec(text),
              let space = m.group(1, in: text),
              let word = m.group(2, in: text)
        else { return nil }
        let wholeLength = m.range.length
        let neg = m.group(3, in: text) ?? ""
        let lower = word.lowercased()
        // A second verb joined on must agree too ("was and is"): keep the label.
        let rest = text.substring(from: wholeLength) as NSString
        if let joined = enJoined.exec(rest), let second = joined.group(1, in: rest),
           enBeHave[second.lowercased()] != nil || enKnownVerb(second) != nil {
            return nil
        }
        if let be = enBeHave[lower] { return Rendered(text: "you\(space)\(be)\(neg)", consumed: wholeLength) }
        // "can't" splits as "ca" + "n't", "won't" as "wo" + "n't".
        if !neg.isEmpty { return enNeutralNeg.contains(lower) ? Rendered(text: "you", consumed: 0) : nil }
        if enNeutralNext.contains(lower) || enObjectNext.contains(lower) { return Rendered(text: "you", consumed: 0) }
        if enPast.test(lower) && !enEed.test(lower) { return Rendered(text: "you", consumed: 0) }
        guard let base = enKnownVerb(word) else { return nil }
        let trimmed = jsTrimEnd(before)
        let subject = trimmed.isEmpty || enSubjectEnd.test(trimmed) || enSubjectIntro.contains(prev)
        if !subject && enVerbLike(prev) { return nil }
        return Rendered(text: "you\(space)\(base)", consumed: wholeLength)
    }

    // Turkish narrator: "sen" forms, only where the result is surely grammatical.

    private static let trSelfCase: [TrCase: String] = [
        .dat: "sana",
        .acc: "seni",
        .abl: "senden",
        .loc: "sende",
        .locki: "sendeki",
        .ins: "seninle",
        .genki: "seninki",
    ]

    /// Postpositions after a bare narrator label: a pronoun takes the
    /// genitive before them ("Taraf A için" -> "senin için"), and a few carry
    /// a possessive that turns second person ("açısından" -> "açından").
    private static let trSelfPostposition: [String: String] = [
        "için": "senin için",
        "gibi": "senin gibi",
        "kadar": "senin kadar",
        "hakkında": "senin hakkında",
        "ile": "seninle",
        "tarafından": "senin tarafından",
        "yüzünden": "senin yüzünden",
        "açısından": "senin açından",
        "sayesinde": "senin sayende",
        "adına": "senin adına",
        "yerine": "senin yerine",
        "lehine": "senin lehine",
        "aleyhine": "senin aleyhine",
    ]

    private static let trAdverbs =
        "daha|çok|biraz|kesinlikle|tamamen|kısmen|büyük ölçüde|genel olarak|yine de|bu konuda|burada|bu kez|bu sefer|açıkça|haklı olarak"

    /// Words ending like a possessive that are quantifiers or adverbs, not a
    /// possessed noun ("Taraf A'nın çoğu iddiası").
    private static let trNotPossessed = JSPattern(#"^(?:çoğu|birçoğu|aşağı|elmas)"#)
    private static let trSoftG = JSPattern(#"ğ[ıiuü]\z"#)
    private static let trVerbalNoun = JSPattern(#"(?:[^aeıioöuü]|m[ae])m[ae](s[ıi])(n(?:[ae]|[ıi]|[dt][ae]n?|[ıi]n)|yl[ae])?\z"#)

    /// The word after "Taraf A'nın", turned to agree with "senin", or nil
    /// when that cannot be done safely. Only two endings are unambiguous:
    /// "-ğI" gains "-n" ("olduğu" -> "olduğun"), and a verbal noun "-mAsI"
    /// after a consonant turns "-n" ("gelmesi" -> "gelmen", "yapmasına" ->
    /// "yapmana", "gelmesiyle" -> "gelmenle"). Everything else depends on the
    /// stem and is left alone.
    private static func trPossessedSecondPerson(_ word: String) -> String? {
        let w = word.lowercased(with: turkishLocale)
        if trNotPossessed.test(w) { return nil }
        if trSoftG.test(w) { return word + "n" }
        let lower = w as NSString
        guard let m = trVerbalNoun.exec(lower), let possessive = m.group(1, in: lower) else { return nil }
        let ending = m.group(2, in: lower)
        let at = lower.length - (possessive as NSString).length - ((ending as NSString?)?.length ?? 0)
        let tail: String
        if let ending {
            tail = ending.hasPrefix("y") ? "nl" + jsSlice(word, -1) : jsSlice(word, at + 2)
        } else {
            tail = "n"
        }
        return jsSlice(word, 0, at) + tail
    }

    private static let trPostposition = JSPattern(#"^\s+(\p{L}+)(?!\p{L})"#)
    private static let trRight = JSPattern(
        #"^\s+((?:(?:"# + trAdverbs + #")\s+)*)(haklı|haksız)(y?dı)?(?=\s*(?:[.!?,;:)…—–]|\z))"#
    )
    private static let trNextWord = JSPattern(#"^(\s+)(\p{L}+)"#)
    private static let trClitic = JSPattern(#"^(\s+)(da|de|mı|mi|mu|mü)(?![\p{L}\p{N}])"#)
    private static let trBackForm = JSPattern(#"[aıou][^aeıioöuü]*\z"#)

    /// `trCase` nil is the nominative (a bare label).
    private static func trNarrator(_ trCase: TrCase?, after: String) -> Rendered? {
        let text = after as NSString
        guard let trCase else {
            if let post = trPostposition.exec(text), let word = post.group(1, in: text),
               let phrase = trSelfPostposition[word.lowercased(with: turkishLocale)] {
                return Rendered(text: phrase, consumed: post.range.length)
            }
            if let right = trRight.exec(text), let adj = right.group(2, in: text) {
                let adverbs = right.group(1, in: text) ?? ""
                let ending = right.group(3, in: text).map { "\($0)n" } ?? "sın"
                return Rendered(text: "sen \(adverbs)\(adj)\(ending)", consumed: right.range.length)
            }
            return nil
        }
        if trCase == .gen {
            guard let next = trNextWord.exec(text),
                  let space = next.group(1, in: text),
                  let word = next.group(2, in: text),
                  let turned = trPossessedSecondPerson(word)
            else { return nil }
            return Rendered(text: "senin\(space)\(turned)", consumed: next.range.length)
        }
        guard let form = trSelfCase[trCase] else { return nil }
        // A following "da/de" or question particle agrees with the label
        // ("Taraf A'da da"); make it agree with the pronoun ("sende de", "sana da").
        guard let clitic = trClitic.exec(text),
              let space = clitic.group(1, in: text),
              let word = clitic.group(2, in: text)
        else { return Rendered(text: form, consumed: 0) }
        let back = trBackForm.test(form)
        let particle = word.hasPrefix("m") ? (back ? "mı" : "mi") : back ? "da" : "de"
        return Rendered(text: "\(form)\(space)\(particle)", consumed: clitic.range.length)
    }

    private struct Rendered {
        let text: String
        /// UTF-16 units of the text after the label that `text` replaces too.
        let consumed: Int
    }

    private static func renderEn(_ party: Resolved, suffix: String?, apos: String, before: String, after: String) -> Rendered? {
        var possessive = false
        if let suffix {
            if suffix == "s" {
                possessive = true
            } else {
                // A Turkish suffix left in English text: a genitive reads as
                // "'s", any other case is dropped.
                guard let c = classifyTr(suffix) else { return nil }
                possessive = c == .gen || c == .genki
            }
        }
        if !party.isSelf {
            return Rendered(text: possessive ? "\(party.name)\(apos.isEmpty ? "'" : apos)s" : party.name, consumed: 0)
        }
        guard let r = possessive ? Rendered(text: "your", consumed: 0) : enNarrator(before: before, after: after) else { return nil }
        return atSentenceStart(before) ? Rendered(text: capitalize(r.text, .en), consumed: r.consumed) : r
    }

    private static func renderTr(_ party: Resolved, suffix: String?, apos: String, before: String, after: String) -> Rendered? {
        let trCase: TrCase?
        if let suffix {
            guard let c = suffix == "s" ? TrCase.gen : classifyTr(suffix) else { return nil }
            trCase = c
        } else {
            trCase = nil
        }
        if !party.isSelf {
            guard let trCase else { return Rendered(text: party.name, consumed: 0) }
            guard let tail = trSuffix(party.name, trCase) else { return nil }
            return Rendered(text: "\(party.name)\(apos.isEmpty ? "'" : apos)\(tail)", consumed: 0)
        }
        guard let r = trNarrator(trCase, after: after) else { return nil }
        return atSentenceStart(before) ? Rendered(text: capitalize(r.text, .tr), consumed: r.consumed) : r
    }

    /// Put real names back into verdict text written with labels.
    /// `textLang` is the language the text is written in. Names get the
    /// suffix the sentence needs ("Taraf B'nin" -> "Deniz'in"; "Party B's"
    /// -> "Deniz's"). A narrator becomes "you"/"sen" only where that stays
    /// grammatical; any other label is left as written.
    static func restoreNames(_ text: String, parties: [String: Resolved], textLang: AppLang) -> String {
        if text.isEmpty || parties.isEmpty { return text }
        let source = text as NSString
        var out = ""
        var pos = 0
        var lastIndex = 0
        while let m = labelInText.exec(source, from: lastIndex) {
            let start = m.range.location
            let end = start + m.range.length
            lastIndex = end
            guard let word = m.group(1, in: source), let letter = m.group(2, in: source) else { continue }
            let apos = m.group(3, in: source) ?? ""
            let suffix = m.group(4, in: source)
            let isParty = word == "Party" || word == "Taraf"
            if isParty != (letter == "A" || letter == "B") { continue }
            guard let party = parties[letter] else { continue }
            let before = source.substring(to: start)
            let after = source.substring(from: end)
            let rendered = textLang == .tr
                ? renderTr(party, suffix: suffix, apos: apos, before: before, after: after)
                : renderEn(party, suffix: suffix, apos: apos, before: before, after: after)
            guard let r = rendered else { continue }
            out += source.substring(with: NSRange(location: pos, length: start - pos)) + r.text
            pos = end + r.consumed
            lastIndex = pos
        }
        return out + source.substring(from: pos)
    }

    /// The verdict with real names in its free text, for the author's own
    /// view only. `selfLang` is the language the argument was judged in
    /// (narrator detection); the grammar follows the language the text is
    /// written in, which differs once the verdict has been translated.
    /// Returns the result unchanged when there is nothing to restore.
    static func personalizeResult(_ result: VerdictResult, nameMap: [NameMapping], selfLang: AppLang) -> VerdictResult {
        let parties = resolveParties(nameMap, selfLang: selfLang)
        if parties.isEmpty { return result }
        let lang = ContentLang.verdictLang(result)
        func r(_ s: String) -> String { restoreNames(s, parties: parties, textLang: lang) }
        var out = result
        out.headline = r(result.headline)
        out.why = result.why.map(r)
        out.crux = r(result.crux)
        out.losingSideBestPoint = r(result.losingSideBestPoint)
        out.splitPoints = result.splitPoints?.map { point in
            var point = point
            point.point = r(point.point)
            return point
        }
        out.conditional = result.conditional?.map { branch in
            var branch = branch
            branch.ifValue = r(branch.ifValue)
            branch.then = r(branch.then)
            return branch
        }
        out.argumentMap.sideA = result.argumentMap.sideA.map { claim in
            var claim = claim
            claim.claim = r(claim.claim)
            return claim
        }
        out.argumentMap.sideB = result.argumentMap.sideB.map { claim in
            var claim = claim
            claim.claim = r(claim.claim)
            return claim
        }
        out.argumentMap.bedrockA = r(result.argumentMap.bedrockA)
        out.argumentMap.bedrockB = r(result.argumentMap.bedrockB)
        out.factsReliedOn = result.factsReliedOn.map { r($0) }
        if case .lean(var lean) = result.lean {
            lean.reason = r(lean.reason)
            out.lean = .lean(lean)
        }
        if var trial = result.cruxTrial {
            trial.attack = r(trial.attack)
            trial.reasoning = r(trial.reasoning)
            out.cruxTrial = trial
        }
        if var factCheck = result.factCheck {
            factCheck.claims = factCheck.claims.map { claim in
                var claim = claim
                claim.claim = r(claim.claim)
                claim.summary = r(claim.summary)
                return claim
            }
            out.factCheck = factCheck
        }
        out.agreedFacts = result.agreedFacts?.map { r($0) }
        out.disputedFacts = result.disputedFacts?.map { fact in
            var fact = fact
            fact.fact = r(fact.fact)
            fact.partyA = r(fact.partyA)
            fact.partyB = r(fact.partyB)
            return fact
        }
        out.wouldChange = result.wouldChange?.map { r($0) }
        if var appeal = result.appeal {
            appeal.summary = r(appeal.summary)
            out.appeal = appeal
        }
        return out
    }

    /// Real names that may open a conditional clause (never the narrator),
    /// for the clause's keep-capital list.
    static func restoredNames(_ nameMap: [NameMapping], selfLang: AppLang) -> [String] {
        resolveParties(nameMap, selfLang: selfLang)
            .sorted { $0.key < $1.key }
            .filter { !$0.value.isSelf }
            .map { $0.value.name }
    }
}

// MARK: - JavaScript string and RegExp semantics

private let turkishLocale = Locale(identifier: "tr")
private let englishLocale = Locale(identifier: "en")

/// JavaScript's `\s` / String.prototype.trim set: Zs, tab, VT, FF, BOM and
/// the line terminators.
private let jsWhitespace = CharacterSet.whitespaces
    .union(CharacterSet(charactersIn: "\u{0B}\u{0C}\u{FEFF}\n\r\u{2028}\u{2029}"))

private func jsTrim(_ s: String) -> String {
    var scalars = Substring(s).unicodeScalars
    while let first = scalars.first, jsWhitespace.contains(first) { scalars.removeFirst() }
    while let last = scalars.last, jsWhitespace.contains(last) { scalars.removeLast() }
    return String(scalars)
}

private func jsTrimEnd(_ s: String) -> String {
    var scalars = Substring(s).unicodeScalars
    while let last = scalars.last, jsWhitespace.contains(last) { scalars.removeLast() }
    return String(scalars)
}

/// String.prototype.slice on UTF-16 units: negative indices count from the
/// end and out-of-range indices clamp.
private func jsSlice(_ s: String, _ start: Int, _ end: Int? = nil) -> String {
    let text = s as NSString
    let length = text.length
    func clamp(_ i: Int) -> Int { i < 0 ? max(0, length + i) : min(i, length) }
    let from = clamp(start)
    let to = clamp(end ?? length)
    return from < to ? text.substring(with: NSRange(location: from, length: to - from)) : ""
}

/// \p{L}, as a JavaScript `u` regex reads it.
private func isLetter(_ s: Unicode.Scalar) -> Bool {
    switch s.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
    default: return false
    }
}

/// A compiled pattern used like a JavaScript RegExp. Patterns are written
/// with `\z` where the JavaScript source has `$` (without the m flag, `$`
/// is the very end of the input; ICU's `$` also matches before a final line
/// break). Unlike JavaScript, ICU's `\s` also matches NEL (U+0085) and
/// misses BOM (U+FEFF); verdict text contains neither.
/// Immutable after init, so safe to share across threads.
private struct JSPattern: @unchecked Sendable {
    let regex: NSRegularExpression

    init(_ pattern: String) {
        // The patterns are literals covered by the golden tests.
        regex = try! NSRegularExpression(pattern: pattern)
    }

    /// RegExp.prototype.exec from `lastIndex`: lookbehind still sees the
    /// text before it.
    func exec(_ text: NSString, from lastIndex: Int = 0) -> NSTextCheckingResult? {
        guard lastIndex <= text.length else { return nil }
        let range = NSRange(location: lastIndex, length: text.length - lastIndex)
        return regex.firstMatch(in: text as String, options: [.withTransparentBounds, .withoutAnchoringBounds], range: range)
    }

    func test(_ text: String) -> Bool { exec(text as NSString) != nil }

    /// String.prototype.replace with a non-global pattern.
    func replaceFirst(in text: String, with replacement: String) -> String {
        let source = text as NSString
        guard let m = exec(source) else { return text }
        return source.replacingCharacters(in: m.range, with: replacement)
    }
}

private extension NSTextCheckingResult {
    /// Capture group `i`, or nil when it did not take part (JavaScript's undefined).
    func group(_ i: Int, in text: NSString) -> String? {
        let r = range(at: i)
        return r.location == NSNotFound ? nil : text.substring(with: r)
    }
}
