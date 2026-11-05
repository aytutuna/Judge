import SwiftUI

/// The Mids on the New page, a layer in the free space above the box. They
/// never take touches or VoiceOver. Frames are drawn about 30 times a second
/// and stop while the app is in the background, the tab is hidden, something
/// covers the page, Reduce Motion is on, or the scene is not live
/// (screenshot states: one fixed pose).
struct MidsPlayground: View {
    /// Someone is writing: the Mids look down at the box.
    let typing: Bool
    /// The side menu, a sheet or the judging cover is over the page.
    let covered: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.tabShown) private var tabShown
    @Environment(\.sceneLive) private var live
    @Environment(\.colorScheme) private var scheme
    @Environment(\.sides) private var sides
    @State private var seed = UInt64.random(in: UInt64.min...UInt64.max)
    @State private var started = Date.now
    @State private var pausedAt: Date?
    @State private var gaze = Gaze()

    /// Below this the Mids would not fit between the top and the box.
    private static let minHeight: CGFloat = 150

    private var animated: Bool { live && !reduceMotion }
    private var running: Bool { animated && scenePhase == .active && tabShown && !covered }

    var body: some View {
        GeometryReader { geo in
            if geo.size.height >= Self.minHeight {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !running)) { timeline in
                    let current = snapshot(at: timeline.date)
                    Canvas { context, size in
                        current.draw(context, size: size)
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: typing, initial: true) { _, isTyping in
            gaze = gaze.moved(to: isTyping, at: Date.now.timeIntervalSinceReferenceDate)
        }
        .onChange(of: running) { _, isRunning in
            // The Mids carry on from where they stopped.
            if isRunning {
                if let pausedAt { started = started.addingTimeInterval(Date.now.timeIntervalSince(pausedAt)) }
                pausedAt = nil
            } else {
                pausedAt = .now
            }
        }
    }

    private func snapshot(at date: Date) -> PlaygroundFrame {
        PlaygroundFrame(
            painter: MidPainter(clock: animated ? max(0, date.timeIntervalSince(started)) : 0, animated: animated, dark: scheme == .dark, sides: sides),
            wander: MidsWander(seed: live ? seed : 1),
            gaze: animated ? gaze.value(at: date.timeIntervalSinceReferenceDate) : gaze.to
        )
    }
}

/// The Mids on the judging card, acting out the stage the verdict has
/// reached. Decorative: the captions around it carry the meaning.
struct MidsJudging: View {
    let stage: JudgingStage
    /// The flag each Mid raises once the votes are known.
    let flags: [Party?]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.sceneLive) private var live
    @Environment(\.colorScheme) private var scheme
    @Environment(\.sides) private var sides
    @State private var shift: MidsShift

    init(stage: JudgingStage, flags: [Party?]) {
        self.stage = stage
        self.flags = flags
        _shift = State(initialValue: MidsShift(stage: stage, since: Date.now.timeIntervalSinceReferenceDate))
    }

    private var animated: Bool { live && !reduceMotion }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !(animated && scenePhase == .active))) { timeline in
            let now = timeline.date.timeIntervalSinceReferenceDate
            let frame = JudgingFrame(
                painter: MidPainter(clock: animated ? now : 0, animated: animated, dark: scheme == .dark, sides: sides),
                shift: live ? shift : MidsShift(stage: .read, since: 0),
                flags: flags,
                now: now
            )
            Canvas { context, size in
                frame.draw(context, size: size)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: stage) { _, next in
            shift = shift.moved(to: next, at: Date.now.timeIntervalSinceReferenceDate)
        }
    }
}
