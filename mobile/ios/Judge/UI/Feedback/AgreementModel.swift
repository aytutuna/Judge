import Foundation
import Observation

/// The one-time "my text may include private details" tick. The server asks
/// for it with `agreement_required` before a first verdict or case side; the
/// request that hit it waits here and is sent again once the person agreed.
@MainActor
@Observable
final class AgreementModel {
    private(set) var asking = false
    private(set) var busy = false
    private(set) var failed = false

    @ObservationIgnored var send: (@MainActor (AppLang) async throws -> Void)?
    private var waiting: CheckedContinuation<Bool, Never>?

    /// Shows the tick and answers whether the person agreed.
    func ask() async -> Bool {
        guard waiting == nil else { return false }
        failed = false
        asking = true
        return await withCheckedContinuation { waiting = $0 }
    }

    func confirm(lang: AppLang) async {
        guard asking, !busy, let send else { return }
        busy = true
        failed = false
        defer { busy = false }
        do {
            try await send(lang)
            finish(true)
        } catch {
            failed = true
        }
    }

    func cancel() { finish(false) }

    private func finish(_ agreed: Bool) {
        asking = false
        let continuation = waiting
        waiting = nil
        continuation?.resume(returning: agreed)
    }
}
