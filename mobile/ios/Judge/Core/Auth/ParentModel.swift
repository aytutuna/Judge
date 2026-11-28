import Foundation
import Observation

/// What the parent step shows.
enum ParentScreen: Equatable {
    /// The request has not been read yet.
    case loading
    /// The address to ask: first time, after a change, or asking again.
    case form
    /// A link went out; waiting for the parent.
    case waiting
    case declined
    case revoked
}

extension ParentView {
    /// A resend is allowed: tries are left and the wait since the last mail is over.
    func canResend(now: Date = Date()) -> Bool {
        guard resendsLeft > 0 else { return false }
        guard let at = resendAt.flatMap(ErrorText.parseISO) else { return true }
        return at <= now
    }

    var canChange: Bool { changesLeft > 0 }
}

/// The parent step of a teen whose account waits for a parent's yes: where
/// the request stands, and giving, changing or resending the parent's address.
@MainActor
@Observable
final class ParentModel {
    private(set) var view: ParentView?
    private(set) var posting = false
    private(set) var error: APIError?
    var email = ""
    /// Typing a new address over one that was already sent.
    private(set) var changing = false

    @ObservationIgnored private let api: JudgeAPI
    /// Told after a call went through, so the account reads /me again (a
    /// revoked account that asked again is waiting again).
    @ObservationIgnored var onChanged: (() async -> Void)?
    /// The app's language, for the mail the server sends the parent.
    @ObservationIgnored var language: () -> AppLang = { .en }
    /// Bumped when the account changes and when a call lands, so an older
    /// reply never overwrites a newer state.
    @ObservationIgnored private var version = 0

    init(api: JudgeAPI) {
        self.api = api
    }

    /// Which screen the account's parent state and the request call for.
    static func screen(state: ParentState?, view: ParentView?, changing: Bool) -> ParentScreen {
        switch state {
        case .declined: return .declined
        case .revoked: return .revoked
        default:
            guard let view else { return .loading }
            return view.sent && !changing ? .waiting : .form
        }
    }

    /// Whether the last read failed (the declined page offers a retry).
    private(set) var loadFailed = false

    func load() async {
        let started = version
        do {
            let fresh = try await api.parentView()
            guard started == version else { return }
            view = fresh
            error = nil
            loadFailed = false
        } catch {
            guard started == version else { return }
            loadFailed = view == nil
        }
    }

    func startChange() {
        changing = true
        error = nil
    }

    func cancelChange() {
        changing = false
        email = ""
        error = nil
    }

    func send() async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty else { return }
        let lang = language()
        await run { try await $0.sendParent(email: address, lang: lang) }
    }

    func resend() async {
        let lang = language()
        await run { try await $0.resendParent(lang: lang) }
    }

    func reset() {
        version += 1
        posting = false
        loadFailed = false
        view = nil
        error = nil
        email = ""
        changing = false
    }

    private func run(_ call: (JudgeAPI) async throws -> ParentView) async {
        guard !posting else { return }
        posting = true
        error = nil
        let started = version
        defer { if started == version { posting = false } }
        do {
            let fresh = try await call(api)
            guard started == version else { return }
            version += 1
            posting = false
            view = fresh
            email = ""
            changing = false
            await onChanged?()
        } catch let failure as APIError {
            guard started == version else { return }
            error = failure
            // The request moved on under us: show where it stands now.
            if ["parent_conflict", "parent_declined", "parent_limit"].contains(failure.code) {
                await load()
                await onChanged?()
            }
        } catch {
            return
        }
    }
}
