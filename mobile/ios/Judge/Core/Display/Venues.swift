import Foundation

/// The places the court can be drawn in. The ids are Resources/Court/venues.json
/// (written from lib/venues.ts); the pick rule is `pickVenue` there. A missing
/// or unknown id is the court.
enum Venues {
    static let lastKey = "judge-venue-last"
    static let fallback = "court"

    /// The shared list, else just the court when the file can't be read.
    static func load(bundle: Bundle = .main) -> [String] {
        // The Judge folder is a synchronized group, which copies resources
        // flat into the bundle, so both places are tried.
        guard let url = bundle.url(forResource: "venues", withExtension: "json", subdirectory: "Court")
            ?? bundle.url(forResource: "venues", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let list = try? JSONDecoder().decode([String].self, from: data),
            !list.isEmpty
        else { return [fallback] }
        return list
    }

    /// Any id but `last` (unless there is only one), at index
    /// min(floor(random * count), count - 1). `random` is in [0, 1).
    static func pick(ids: [String], last: String?, random: Double) -> String {
        guard !ids.isEmpty else { return fallback }
        let pool = ids.filter { $0 != last || ids.count == 1 }
        return pool[min(Int(random * Double(pool.count)), pool.count - 1)]
    }

    /// A fresh pick, remembered as the last one shown.
    static func pickNew(defaults: UserDefaults = .standard, bundle: Bundle = .main, random: Double = .random(in: 0..<1)) -> String {
        let id = pick(ids: load(bundle: bundle), last: defaults.string(forKey: lastKey), random: random)
        defaults.set(id, forKey: lastKey)
        return id
    }
}
