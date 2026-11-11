import Foundation

/// What the owner called sides B, C and D when sending the link, kept on this
/// phone only (lib/side-names-store.ts). They label the rows on the case page.
enum SideNames {
    private static func key(_ caseID: String) -> String { "sidenames.\(caseID)" }

    static func save(caseID: String, _ names: [Party: String]) {
        var kept: [String: String] = [:]
        for (party, name) in names {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { kept[party.rawValue] = trimmed }
        }
        if kept.isEmpty { return }
        UserDefaults.standard.set(kept, forKey: key(caseID))
    }

    static func load(caseID: String) -> [Party: String] {
        let stored = UserDefaults.standard.dictionary(forKey: key(caseID)) as? [String: String] ?? [:]
        return Dictionary(uniqueKeysWithValues: stored.compactMap { raw, name in
            Party(rawValue: raw).map { ($0, name) }
        })
    }

    static func forget(caseID: String) {
        UserDefaults.standard.removeObject(forKey: key(caseID))
    }
}
