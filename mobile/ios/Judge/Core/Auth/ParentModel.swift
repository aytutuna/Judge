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

    func load() async {
        if let fresh = try? await api.parentView() { view = fresh }
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
        await run { try await $0.sendParent(email: address) }
    }

    func resend() async {
        await run { try await $0.resendParent() }
    }

    func reset() {
        view = nil
        error = nil
        email = ""
        changing = false
    }

    private func run(_ call: (JudgeAPI) async throws -> ParentView) async {
        guard !posting else { return }
        posting = true
        error = nil
        defer { posting = false }
        do {
            view = try await call(api)
            email = ""
            changing = false
            await onChanged?()
        } catch let failure as APIError {
            error = failure
            // The request moved on under us: show where it stands now.
            if failure.code == "parent_conflict" || failure.code == "parent_declined" {
                await load()
                await onChanged?()
            }
        } catch {
            return
        }
    }
}
