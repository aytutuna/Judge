import SwiftUI

/// Reads the pending verdict in its own body, so the cover updates the
/// moment it arrives.
struct JudgingCover: View {
    let home: HomeModel
    let lang: AppLang

    var body: some View {
        JudgingView(
            lang: lang,
            result: home.arrived,
            onFinished: { home.judgingFinished() },
            onCancel: { home.cancel() }
        )
    }
}

/// Full-screen cover while a verdict is pending: the rocking balance, the
/// judge dots and rotating captions, driven by the port of lib/thinking.ts.
/// When the verdict lands the finish sequence plays, the beam springs to
/// the winner's side, and after a short hold `onFinished` hands over.
struct JudgingView: View {
    let lang: AppLang
    /// Non-nil once the verdict has arrived.
    let result: VerdictResult?
    let onFinished: () -> Void
    let onCancel: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var state: Thinking.DigState = .initial
    @State private var finished = false
    @State private var started = Date.now
    @State private var settle: Settle?

    /// When and from which angle the beam started springing to its verdict.
    private struct Settle: Equatable {
        let start: Date
        let from: Double
        let target: Double
    }

    private struct TickKey: Equatable {
        let state: Thinking.DigState
        let done: Bool
        let finished: Bool
        let skip: Bool
    }

    private var done: Bool { result != nil }
    private var skip: Bool { reduceMotion || scenePhase != .active }

    var body: some View {
        let captionKey = Thinking.announcementKey(state, done: done)
        VStack(spacing: 0) {
            HStack {
                Spacer()
                Button(action: onCancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Brand.ink2)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Brand.paper))
                        .overlay(Circle().strokeBorder(Brand.line2, lineWidth: 1))
                }
                .accessibilityLabel(L10n.appCancel(lang))
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)

            Spacer(minLength: 24)

            VStack(spacing: 28) {
                Kicker(text: L10n.thinkingEyebrow(lang))

                TimelineView(.animation(minimumInterval: nil, paused: timelinePaused)) { context in
                    VStack(spacing: 26) {
                        BalanceCanvas(angle: angle(at: context.date))
                            .frame(width: 240, height: 190)
                        dots(at: context.date)
                    }
                }

                ZStack {
                    Text(L10n.text(captionKey, lang) ?? "")
                        .brandText(.lead)
                        .foregroundStyle(Brand.ink)
                        .multilineTextAlignment(.center)
                        .id(captionKey)
                        .transition(.opacity)
                }
                .frame(minHeight: 56, alignment: .top)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: captionKey)
                .accessibilityHidden(true)

                Text(L10n.thinkingHelper(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 12)
            }
            .padding(.horizontal, 28)

            Spacer(minLength: 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.ivory.ignoresSafeArea())
        .task(id: TickKey(state: state, done: done, finished: finished, skip: skip)) {
            await tick()
        }
        .onChange(of: done) { _, _ in startSettle() }
        .onChange(of: captionKey) { _, key in
            AccessibilityNotification.Announcement(L10n.text(key, lang) ?? "").post()
        }
        .onAppear {
            startSettle()
            AccessibilityNotification.Announcement(L10n.text(captionKey, lang) ?? "").post()
        }
        .sensoryFeedback(.impact(weight: .light), trigger: done) { _, isDone in isDone && !reduceMotion }
    }

    /// One step of the state machine (re-run whenever its inputs change).
    private func tick() async {
        if finished {
            let hold = skip ? 0 : Thinking.revealHoldMs
            try? await Task.sleep(for: .milliseconds(hold))
            guard !Task.isCancelled else { return }
            onFinished()
            return
        }
        let plan = Thinking.plan(state, done: done, skip: skip)
        if plan.delayMs > 0 {
            do {
                try await Task.sleep(for: .milliseconds(plan.delayMs))
            } catch {
                return
            }
        }
        guard !Task.isCancelled else { return }
        if let next = plan.next {
            state = next
        } else {
            finished = true
        }
    }

    /// The verdict is in: spring from wherever the rock is to the verdict angle.
    private func startSettle() {
        guard settle == nil, let result else { return }
        let target = VerdictDisplay.rotationDegrees(tugA: VerdictDisplay.sceneTug(result))
        let now = Date.now
        settle = Settle(start: now, from: reduceMotion ? target : rockingAngle(at: now), target: target)
    }

    private var timelinePaused: Bool {
        if reduceMotion { return true }
        guard let settle else { return false }
        return Date.now.timeIntervalSince(settle.start) > BalanceMotion.settleDuration && finished
    }

    private func rockingAngle(at date: Date) -> Double {
        reduceMotion ? 0 : BalanceMotion.rockAngle(at: date.timeIntervalSince(started))
    }

    private func angle(at date: Date) -> Double {
        guard let settle else { return rockingAngle(at: date) }
        if reduceMotion { return settle.target }
        return BalanceMotion.springAngle(from: settle.from, to: settle.target, elapsed: date.timeIntervalSince(settle.start))
    }

    @ViewBuilder
    private func dots(at date: Date) -> some View {
        let dots = Thinking.judgeDots(done ? result : nil)
        HStack(spacing: 10) {
            ForEach(Array(dots.enumerated()), id: \.offset) { index, dot in
                Circle()
                    .fill(fill(dot))
                    .overlay(Circle().strokeBorder(stroke(dot), lineWidth: 1.5))
                    .frame(width: 12, height: 12)
                    .opacity(dot == .pending ? pulse(at: date, index: index) : 1)
            }
        }
        .accessibilityHidden(true)
    }

    private func pulse(at date: Date, index: Int) -> Double {
        guard !reduceMotion else { return 0.6 }
        let t = date.timeIntervalSince(started) - Double(index) * 0.12
        return 0.35 + 0.45 * (0.5 + 0.5 * sin(2 * .pi * t / 1.4))
    }

    private func fill(_ dot: Thinking.Dot) -> Color {
        switch dot {
        case .pending: return Brand.ink.opacity(0.35)
        case .vote(.a): return Brand.terra
        case .vote(.b): return Brand.sageStrong
        case .vote(.other): return .clear
        }
    }

    private func stroke(_ dot: Thinking.Dot) -> Color {
        dot == .vote(.other) ? Brand.ink : .clear
    }
}
