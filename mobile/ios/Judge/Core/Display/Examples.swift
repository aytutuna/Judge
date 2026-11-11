import Foundation

/// One "Try an example": both names and both sides of a made-up argument.
struct ExampleCase: Sendable, Equatable, Decodable {
    let id: String
    let title: String
    let aName: String
    let a: String
    let bName: String
    let b: String
}

/// The example data and which one to show next. Each language has one file
/// (Resources/Examples/<lang>.json, the same ids in the same order in all of
/// them); the pick rule is lib/example-pick.ts.
enum Examples {
    static let seenKey = "judge-examples-seen"

    /// The language's examples, else English; empty when neither can be read.
    static func load(_ lang: AppLang, bundle: Bundle = .main) -> [ExampleCase] {
        for code in [lang.rawValue, AppLang.en.rawValue] {
            // The Judge folder is a synchronized group, which copies resources
            // flat into the bundle, so both places are tried.
            guard let url = bundle.url(forResource: code, withExtension: "json", subdirectory: "Examples")
                ?? bundle.url(forResource: code, withExtension: "json"),
                let data = try? Data(contentsOf: url),
                let list = try? JSONDecoder().decode([ExampleCase].self, from: data),
                !list.isEmpty
            else { continue }
            return list
        }
        return []
    }

    /// `seen` lists the ids shown in the current round, oldest first; its last
    /// entry is the example on screen. Unseen ids are picked at random until
    /// all have been shown, then a new round starts that never opens with the
    /// one just shown. `random` is in [0, 1).
    static func next(ids: [String], seen: [String], random: Double) -> (id: String, seen: [String])? {
        guard !ids.isEmpty else { return nil }
        let known = seen.filter { ids.contains($0) }
        let last = known.last
        let unseen = ids.filter { !known.contains($0) }
        let fresh = unseen.isEmpty
        let pool = (fresh ? ids : unseen).filter { $0 != last || ids.count == 1 }
        let id = pool[min(Int(random * Double(pool.count)), pool.count - 1)]
        return (id, fresh ? [id] : known + [id])
    }

    static func loadSeen(_ defaults: UserDefaults) -> [String] {
        guard let data = defaults.data(forKey: seenKey),
              let list = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return list
    }

    static func saveSeen(_ seen: [String], _ defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(seen) { defaults.set(data, forKey: seenKey) }
    }
}
