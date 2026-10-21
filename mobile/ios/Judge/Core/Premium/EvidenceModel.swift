import Foundation
import Observation
import UIKit

/// Where one picked screenshot stands (lib/case-types.ts EvidenceStatus plus
/// "reading" while it is prepared and uploaded).
enum EvidenceItemStatus: String, Sendable, Equatable {
    case reading, ok, unreadable, refused, unsupported
    case tooLarge = "too_large"
    case failed

    /// A server status string; anything unknown reads as failed.
    init(server: String) {
        self = EvidenceItemStatus(rawValue: server) ?? .failed
    }

    func text(_ lang: AppLang) -> String {
        switch self {
        case .reading: return L10n.evidenceReading(lang)
        case .ok: return L10n.evidenceOk(lang)
        case .unreadable: return L10n.evidenceStatusUnreadable(lang)
        case .refused: return L10n.evidenceStatusRefused(lang)
        case .unsupported: return L10n.evidenceStatusUnsupported(lang)
        case .tooLarge: return L10n.evidenceStatusTooLarge(lang)
        case .failed: return L10n.evidenceStatusFailed(lang)
        }
    }
}

struct EvidenceItem: Identifiable, Equatable {
    let id: UUID
    /// Position label shown to the user, 1-based, stable while the item lives.
    let n: Int
    /// The (downscaled) image, for the thumbnail.
    var thumb: UIImage?
    var status: EvidenceItemStatus
    /// Signed token to send with the submission (status ok only).
    var token: String?
    /// The raw transcript (may contain real names): the uploader's eyes only.
    var preview: String?
}

/// Screenshot evidence (port of useEvidence in components/case/EvidencePicker.tsx):
/// up to `max` images, each prepared on the phone and uploaded right away
/// (POST /api/v1/evidence), so reading overlaps with writing. Only the
/// tokens of the images read successfully go with the submission, in order.
/// Images are never kept: not here, not on the server.
@MainActor
@Observable
final class EvidenceModel {
    let max: Int
    private(set) var items: [EvidenceItem] = []
    /// The last whole-request failure, if any.
    private(set) var failure: APIError?
    /// True right after the user picked more images than fit.
    private(set) var overLimit = false

    @ObservationIgnored private var counter = 0

    init(max: Int) {
        self.max = max
    }

    /// Tokens of the images read successfully, in order.
    var tokens: [String] { items.compactMap { $0.status == .ok ? $0.token : nil } }
    /// Images still being read: a submission waits for them.
    var busy: Bool { items.contains { $0.status == .reading } }
    var full: Bool { items.count >= max }
    var room: Int { Swift.max(0, max - items.count) }

    /// Adds `count` picked images as "reading" and returns the ids of those
    /// that fit; the rest are dropped with the over-limit note.
    @discardableResult
    func reserve(_ count: Int) -> [UUID] {
        failure = nil
        overLimit = count > room
        let fitting = Swift.min(count, room)
        guard fitting > 0 else { return [] }
        let fresh = (0..<fitting).map { _ -> EvidenceItem in
            counter += 1
            return EvidenceItem(id: UUID(), n: counter, thumb: nil, status: .reading, token: nil, preview: nil)
        }
        items.append(contentsOf: fresh)
        return fresh.map(\.id)
    }

    /// Prepares the reserved images (`files[i]` belongs to `ids[i]`; nil =
    /// it could not be loaded), uploads the ones that decode, and applies the
    /// answer by index. Items removed meanwhile are left alone. A 401 ends
    /// the session and a 402 refreshes the account, as everywhere else.
    func process(_ ids: [UUID], files: [Data?], api: JudgeAPI, account: AccountModel? = nil) async {
        let prepared: [PreparedImage?] = await Task.detached(priority: .userInitiated) {
            files.map { file in file.flatMap(ImagePreparation.prepare) }
        }.value

        var send: [(id: UUID, image: PreparedImage)] = []
        for (index, id) in ids.enumerated() {
            let image = index < prepared.count ? prepared[index] : nil
            if let image {
                send.append((id, image))
                update(id) { $0.thumb = UIImage(data: image.data) }
            } else {
                update(id) { $0.status = .unsupported }
            }
        }
        guard !send.isEmpty else { return }

        let results: [EvidenceUploadItem]?
        do {
            results = try await api.uploadEvidence(send.map(\.image))
        } catch let error as APIError {
            failure = error
            results = nil
            if error.code == "signin_required" {
                account?.sessionExpired()
            } else if case .server(let status, _) = error, status == 402 {
                account?.refreshSoon()
            }
        } catch {
            results = nil
        }
        apply(results, sent: send.map(\.id))
    }

    /// Maps one upload answer onto the items that were sent, by index
    /// (applyUploadResult on the web). No answer marks them all failed.
    func apply(_ results: [EvidenceUploadItem]?, sent: [UUID]) {
        for (index, id) in sent.enumerated() {
            update(id) { item in
                guard let result = results?.first(where: { $0.index == index }) else {
                    item.status = .failed
                    return
                }
                let status = EvidenceItemStatus(server: result.status)
                if status == .ok, let token = result.token, !token.isEmpty {
                    item.status = .ok
                    item.token = token
                    item.preview = result.preview
                } else {
                    item.status = status == .ok || status == .reading ? .failed : status
                    item.token = nil
                    item.preview = nil
                }
            }
        }
    }

    func remove(_ id: UUID) {
        overLimit = false
        items.removeAll { $0.id == id }
    }

    func clear() {
        items = []
        failure = nil
        overLimit = false
    }

    private func update(_ id: UUID, _ change: (inout EvidenceItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        change(&items[index])
    }
}

#if DEBUG
extension EvidenceModel {
    /// Screenshot fixtures: fixed items without an upload.
    func showForScreenshot(_ shown: [(status: EvidenceItemStatus, preview: String?)]) {
        items = shown.enumerated().map { index, entry in
            EvidenceItem(
                id: UUID(),
                n: index + 1,
                thumb: nil,
                status: entry.status,
                token: entry.status == .ok ? "fixture-token-\(index + 1)" : nil,
                preview: entry.preview
            )
        }
        counter = items.count
    }
}
#endif
