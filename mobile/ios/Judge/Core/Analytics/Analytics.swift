import Foundation
import OSLog

/// One queued event. `seq` only identifies it on this phone.
struct AnalyticsEvent: Codable, Sendable, Equatable {
    var seq: Int
    var name: String
    /// Milliseconds since 1970.
    var at: Int64
    var props: [String: String]?
}

/// `context` of POST /api/v1/events.
struct AnalyticsContext: Encodable, Sendable, Equatable {
    var platform = "ios"
    var appVersion: String
    var anonID: String
    var deviceID: String?
    var osVersion: String?
    var deviceModel: String?
    var locale: String?

    private enum CodingKeys: String, CodingKey {
        case platform, locale
        case appVersion = "app_version"
        case anonID = "anon_id"
        case deviceID = "device_id"
        case osVersion = "os_version"
        case deviceModel = "device_model"
    }
}

enum AnalyticsDelivery: Sendable {
    case sent
    /// The server refused the batch (400): sending it again would not help.
    case rejected
    /// Offline, rate limited or a server error: try again later.
    case failed
}

protocol AnalyticsTransport: Sendable {
    func sendEvents(_ body: Data) async -> AnalyticsDelivery
}

/// First-party usage events (lib/analytics/track.ts lists the names). They
/// queue in memory and in a file, so a crash loses none, and go out in
/// batches: once 20 are waiting, every 30 s while the app is active and
/// when it goes to the background. Nothing is queued while the user's
/// setting is off or the server's `features.analytics` is false; until
/// /api/v1/config has answered they wait.
@MainActor
final class Analytics {
    static let batchSize = 50
    static let flushAt = 20
    static let cap = 500
    static let interval: Duration = .seconds(30)
    /// Back after longer than this, the app counts as opened again.
    static let sessionGap: TimeInterval = 30 * 60
    /// The rate limit is per hour, so a failed send waits at least a minute.
    static let minBackoff: TimeInterval = 60
    static let maxBackoff: TimeInterval = 15 * 60

    /// The "Usage statistics" setting. Turning it off drops the queue.
    var allowed: Bool {
        didSet { if !allowed { clear() } }
    }

    /// `features.analytics` once /api/v1/config answered.
    private(set) var serverOn: Bool?
    private(set) var queue: [AnalyticsEvent] = []
    /// While the last send failed: when to try again.
    private(set) var retryAt: Date?

    private let transport: any AnalyticsTransport
    private let context: AnalyticsContext
    private let file: URL?
    private let now: () -> Date
    private var nextSeq = 1
    private var sending = false
    private var backoff: TimeInterval = 0
    private var ticker: Task<Void, Never>?
    private var opened = false
    private var leftAt: Date?

    private static let log = Logger(subsystem: "com.okjudge.judge", category: "analytics")

    /// `file` nil keeps the queue in memory only (tests, screenshot states).
    init(transport: any AnalyticsTransport, context: AnalyticsContext, file: URL?, allowed: Bool, now: @escaping () -> Date = { .now }) {
        self.transport = transport
        self.context = context
        self.file = file
        self.allowed = allowed
        self.now = now
        if allowed, let file, let data = try? Data(contentsOf: file),
           let saved = try? JSONDecoder().decode([AnalyticsEvent].self, from: data) {
            queue = Array(saved.suffix(Self.cap))
            nextSeq = (queue.map(\.seq).max() ?? 0) + 1
        } else if !allowed, let file {
            try? FileManager.default.removeItem(at: file)
        }
    }

    static var defaultFile: URL? {
        try? FileManager.default
            .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appending(path: "analytics-queue.json")
    }

    func setServerOn(_ on: Bool) {
        serverOn = on
        if on {
            Task { await flush() }
        } else {
            clear()
        }
    }

    func track(_ name: String, _ props: [String: String] = [:]) {
        guard allowed, serverOn != false else { return }
        if let problem = Self.problem(name: name, props: props) {
            assertionFailure("analytics: \(problem)")
            return
        }
        let at = Int64((now().timeIntervalSince1970 * 1000).rounded())
        queue.append(AnalyticsEvent(seq: nextSeq, name: name, at: at, props: props.isEmpty ? nil : props))
        nextSeq += 1
        if queue.count > Self.cap { queue.removeFirst(queue.count - Self.cap) }
        save()
        if queue.count >= Self.flushAt { Task { await flush() } }
    }

    /// Sends what is queued, a batch at a time, unless a failed send is
    /// still waiting out its backoff.
    func flush() async {
        guard allowed, serverOn == true, !sending else { return }
        if let retryAt, now() < retryAt { return }
        sending = true
        defer { sending = false }
        while allowed, serverOn == true, !queue.isEmpty {
            let batch = Array(queue.prefix(Self.batchSize))
            guard let body = try? encode(batch) else {
                remove(batch)
                continue
            }
            switch await transport.sendEvents(body) {
            case .sent:
                backoff = 0
                retryAt = nil
                remove(batch)
            case .rejected:
                #if DEBUG
                Self.log.error("events refused by the server: \(batch.map(\.name).joined(separator: ","), privacy: .public)")
                #endif
                remove(batch)
            case .failed:
                backoff = min(max(backoff * 2, Self.minBackoff), Self.maxBackoff)
                retryAt = now().addingTimeInterval(backoff)
                return
            }
        }
    }

    /// The scene became active: app_open on a cold start or after a long
    /// absence, and the 30 s flushes.
    func becameActive() {
        let away = leftAt.map { now().timeIntervalSince($0) > Self.sessionGap } ?? !opened
        opened = true
        leftAt = nil
        if away { track("app_open") }
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.interval)
                guard !Task.isCancelled, let self else { return }
                await self.flush()
            }
        }
    }

    func enteredBackground() {
        leftAt = now()
        ticker?.cancel()
        ticker = nil
        guard allowed, serverOn == true, !queue.isEmpty else { return }
        let background = BackgroundActivity(name: "analytics")
        Task {
            await flush()
            background.end()
        }
    }

    private func encode(_ batch: [AnalyticsEvent]) throws -> Data {
        struct Wire: Encodable {
            struct Event: Encodable {
                let name: String
                let at: Int64
                let props: [String: String]?
            }
            let context: AnalyticsContext
            let events: [Event]
        }
        let events = batch.map { Wire.Event(name: $0.name, at: $0.at, props: $0.props) }
        return try JSONEncoder().encode(Wire(context: context, events: events))
    }

    private func remove(_ batch: [AnalyticsEvent]) {
        let sent = Set(batch.map(\.seq))
        queue.removeAll { sent.contains($0.seq) }
        save()
    }

    private func clear() {
        queue = []
        retryAt = nil
        backoff = 0
        save()
    }

    private func save() {
        guard let file else { return }
        if queue.isEmpty {
            try? FileManager.default.removeItem(at: file)
        } else if let data = try? JSONEncoder().encode(queue) {
            try? data.write(to: file, options: .atomic)
        }
    }

    // MARK: - What an event may carry

    /// The one prop each event may have; the rest send none. Values are
    /// short tokens (screen names, product ids, error codes), so nothing
    /// anyone wrote can be put in one.
    static let allowedProps: [String: String] = [
        "screen_view": "screen",
        "buy_tapped": "product",
        "sign_in_started": "provider",
        "settings_changed": "key",
        "error_shown": "code",
    ]
    /// Sent by the server only; it refuses them from the app.
    static let serverEvents: Set<String> = ["case_created", "verdict_ready", "verdict_failed", "case_claimed", "purchase_granted", "sign_in"]

    /// Why the server would refuse this event, or nil.
    static func problem(name: String, props: [String: String]) -> String? {
        guard matches(name, #"^[a-z][a-z0-9_]{0,63}$"#) else { return "bad event name \(name)" }
        if serverEvents.contains(name) { return "\(name) is sent by the server" }
        for (key, value) in props {
            guard allowedProps[name] == key else { return "\(name) takes no prop \(key)" }
            guard matches(value, #"^[A-Za-z0-9_.:/-]{1,64}$"#) else { return "value of \(key) is not a token" }
        }
        return nil
    }

    private static func matches(_ text: String, _ pattern: String) -> Bool {
        !text.contains("\n") && text.range(of: pattern, options: .regularExpression) != nil
    }
}
