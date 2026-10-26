import SwiftUI

/// Reads the pending verdict in its own body, so the cover updates the
/// moment it arrives.
struct JudgingCover: View {
    let home: HomeModel
    let lang: AppLang

    var body: some View {
        JudgingView(
            lang: lang,
            argument: home.judgedArgument,
            result: home.arrived,
            premium: home.judgingPremium,
            onFinished: { home.judgingFinished() },
            onCancel: { home.cancel() }
        )
    }
}

/// The judging turn of the thread, full screen while a verdict is pending:
/// the argument, the judges' badge and a card with the 3D balance (the
/// beats of lib/judging-ui.ts while waiting, the verdict tilt once it is
/// in) over the judge dots and the rotating captions of lib/thinking.ts.
/// After the finish sequence and a short hold `onFinished` hands over.
struct JudgingView: View {
    let lang: AppLang
    /// What was sent; empty hides the bubble.
    var argument = ""
    /// Non-nil once the verdict has arrived.
    let result: VerdictResult?
    /// Premium adds the web fact-check line and its own helper text.
    var premium = false
    let onFinished: () -> Void
    let onCancel: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var state: Thinking.DigState = .initial
    @State private var finished = false
    @State private var started = Date.now
    @State private var settle: Settle?

    /// When and from which angle the flat beam started springing to its verdict.
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

    private var sceneMode: SceneMode {
        if let result { return VerdictDisplay.sceneVerdict(result) }
        return .judging(Thinking.beat(for: state))
    }

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

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !argument.isEmpty {
                        ArgumentBubble(text: argument, lang: lang)
                            .padding(.bottom, 12)
                    }
                    JudgesBadge(label: L10n.threadJudges(lang))
                    card(captionKey: captionKey)
                }
                .padding(16)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
        }
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

    private func card(captionKey: String) -> some View {
        VStack(spacing: 0) {
            SceneView(mode: sceneMode) {
                TimelineView(.animation(minimumInterval: nil, paused: timelinePaused)) { context in
                    BalanceCanvas(angle: angle(at: context.date))
                }
            }
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
            .frame(maxWidth: 480)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            Kicker(text: L10n.thinkingEyebrow(lang))
                .padding(.top, 20)

            TimelineView(.animation(minimumInterval: nil, paused: reduceMotion || done)) { context in
                dots(at: context.date)
            }
            .padding(.top, 14)

            VStack(spacing: 18) {
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

                TimelineView(.animation(minimumInterval: 0.25, paused: done)) { context in
                    progressBar(Thinking.progressAt(elapsedMs: context.date.timeIntervalSince(started) * 1000, done: done))
                }
            }
            .padding(.top, 16)
            .accessibilityHidden(true)

            if premium {
                HStack(spacing: 8) {
                    Image(systemName: done ? "checkmark.circle.fill" : "globe")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(done ? Brand.sageInk : Brand.terraInk)
                        .accessibilityHidden(true)
                    Text(done ? L10n.thinkingFactcheckDone(lang) : L10n.thinkingFactcheck(lang))
                        .brandText(.slotTitle)
                        .foregroundStyle(Brand.ink2)
                }
                .accessibilityElement(children: .combine)
                .padding(.top, 14)
            }

            Text(premium ? L10n.thinkingPremiumHelper(lang) : L10n.thinkingHelper(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
                .padding(.top, 16)
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .paperSurface(radius: Radius.card)
        .cardShadow()
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

    /// The verdict is in: the flat beam springs from wherever the rock is to
    /// the verdict angle (the 3D scene settles by itself).
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

    /// Thin bar under the caption, like the website's: the terra-to-sage
    /// gradient spans the full track and is revealed from the leading edge.
    private func progressBar(_ value: Double) -> some View {
        let fill = min(max(value, 0), 1)
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Brand.ink.opacity(0.08))
                Capsule()
                    .fill(LinearGradient(colors: [Brand.terra, Brand.sageStrong], startPoint: .leading, endPoint: .trailing))
                    .mask(alignment: .leading) {
                        Capsule().frame(width: geo.size.width * fill)
                    }
            }
        }
        .frame(maxWidth: 280)
        .frame(height: 3)
        .animation(reduceMotion ? nil : .linear(duration: 0.3), value: fill)
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
