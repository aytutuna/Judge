import SwiftUI

/// Reads the pending verdict in its own body, so the cover updates the
/// moment it arrives.
struct JudgingCover: View {
    let home: HomeModel
    let lang: AppLang

    var body: some View {
        JudgingView(
            lang: lang,
            sides: home.judgedSides,
            result: home.arrived,
            onFinished: { home.judgingFinished() },
            onCancel: { home.cancel() },
            onNew: {
                // Leaving this way cancels it, like the close button.
                home.cancel()
                home.judgeAnother()
            }
        )
    }
}

/// The judging turn of the thread, full screen while a verdict is pending:
/// the sides that were sent and a card with the 3D balance (the beats of
/// lib/judging-ui.ts while waiting, the verdict tilt once it is in) over
/// the judge dots and the rotating captions of lib/thinking.ts, then Cancel.
/// After the finish sequence and a short hold `onFinished` hands over.
struct JudgingView: View {
    let lang: AppLang
    /// What was sent, a tile per written side.
    var sides: [HomeModel.JudgedSide] = []
    /// Non-nil once the verdict has arrived.
    let result: VerdictResult?
    let onFinished: () -> Void
    let onCancel: () -> Void
    /// The header's "+": a new argument on an empty form.
    var onNew: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.sides) private var colors
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
            HStack(spacing: 10) {
                Text(L10n.appName(lang))
                    .brandText(.brand)
                    .foregroundStyle(Brand.ink)
                Spacer()
                if let onNew {
                    NewArgumentButton(lang: lang, action: onNew)
                }
            }
            .frame(minHeight: 44)
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .accessibilityElement(children: .contain)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !sides.isEmpty {
                        SideTiles(sides: sides, lang: lang)
                    }
                    card(captionKey: captionKey)
                }
                .padding(16)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }

            Button(L10n.appCancel(lang), action: onCancel)
                .brandText(TypeStyle(face: .inter, weight: 600, size: 14, lineHeight: 1.2, textStyle: .subheadline, maxScale: 1.8))
                .foregroundStyle(Brand.ink2)
                .padding(.horizontal, 20)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
                .buttonStyle(.plain)
                .padding(.bottom, 8)
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

            Text(L10n.thinkingPremiumHelper(lang))
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

    /// Thin bar under the caption, like the website's: the gradient from
    /// Party A's colour to Party B's spans the full track and is revealed
    /// from the leading edge.
    private func progressBar(_ value: Double) -> some View {
        let fill = min(max(value, 0), 1)
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Brand.ink.opacity(0.08))
                Capsule()
                    .fill(LinearGradient(colors: [colors.a.strong, colors.b.strong], startPoint: .leading, endPoint: .trailing))
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
        case .vote(.a): return colors.a.strong
        case .vote(.b): return colors.b.strong
        case .vote(.other): return .clear
        }
    }

    private func stroke(_ dot: Thinking.Dot) -> Color {
        dot == .vote(.other) ? Brand.ink : .clear
    }
}

/// What each side said, cut to three lines: yours in green, theirs in red.
/// A verdict on one side has one tile.
private struct SideTiles: View {
    let sides: [HomeModel.JudgedSide]
    let lang: AppLang

    @Environment(\.sides) private var colors

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            ForEach(sides, id: \.mine) { side in
                VStack(alignment: .leading, spacing: 4) {
                    Text(side.name.isEmpty ? (side.mine ? L10n.appHomeYourSide(lang) : L10n.appHomeTheirSide(lang)) : side.name)
                        .brandText(TypeStyle(face: .inter, weight: 700, size: 11, lineHeight: 1.2, tracking: 0.08, textStyle: .caption2, maxScale: 1.6, uppercase: true))
                        .foregroundStyle(side.mine ? colors.mine.ink : colors.theirs.ink)
                        .lineLimit(1)
                    Text(side.text)
                        .brandText(TypeStyle(face: .inter, weight: 400, size: 13, lineHeight: 1.4, textStyle: .footnote))
                        .foregroundStyle(Brand.ink)
                        .lineLimit(3)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(
                    RoundedRectangle(cornerRadius: Radius.field, style: .continuous)
                        .fill(side.mine ? colors.mine.tint : colors.theirs.tint)
                )
                .accessibilityElement(children: .combine)
            }
        }
    }
}
