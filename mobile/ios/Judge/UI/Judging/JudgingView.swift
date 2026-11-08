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
            acceptedAt: home.acceptedAt,
            onFinished: { home.judgingFinished() },
            onCancel: { home.cancel() }
        )
    }
}

/// The judging turn of the thread, full screen while a verdict is pending:
/// the sides that were sent and a card with the street court acting out the
/// story (components/court/story.ts) over a log of what the judges are
/// doing, then Cancel. Once the verdict is in, the rest of the story plays
/// out and `onFinished` hands over.
struct JudgingView: View {
    let lang: AppLang
    /// What was sent, a tile per written side.
    var sides: [HomeModel.JudgedSide] = []
    /// Non-nil once the verdict has arrived.
    let result: VerdictResult?
    /// When the server accepted the request, if it has.
    var acceptedAt: Date?
    let onFinished: () -> Void
    let onCancel: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.sceneLive) private var sceneLive
    @State private var started = Date.now
    /// `acceptedAt` as ms into the story, for the clock loop to read.
    @State private var acceptedMs: Double?
    /// The waiting line the story is on; frozen when the verdict lands.
    @State private var waiting = 0
    @State private var plan: Story.Ending?
    /// How many steps of the plan have played.
    @State private var reached = 0

    private var done: Bool { result != nil }
    private var summary: Story.Summary? { result.map(Story.summarize) }
    private var steps: ArraySlice<Story.Step> { plan?.steps.prefix(reached) ?? [] }
    private var beat: Story.Beat { steps.last?.beat ?? Story.waiting[waiting] }

    private var lines: [Story.Line] {
        let waited = Story.waiting.prefix(waiting + 1).map { Story.Line(key: "story.\($0.rawValue)") }
        return waited + steps.compactMap { $0.line }
    }

    private var liveText: String {
        lines.last.map { Story.text($0, lang: lang) } ?? ""
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !sides.isEmpty {
                        SideTiles(sides: sides, lang: lang)
                    }
                    card
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
        .task(id: done) {
            await run()
        }
        .task(id: liveText) {
            // The catch-up after the verdict changes the line every few
            // hundred ms; only the one that settles is worth announcing.
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            AccessibilityNotification.Announcement(liveText).post()
        }
        .onChange(of: acceptedAt, initial: true) { _, at in
            acceptedMs = at.map { max(0, $0.timeIntervalSince(started) * 1000) }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: done) { _, isDone in isDone && !reduceMotion }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 14) {
            Kicker(text: L10n.thinkingEyebrow(lang))

            CourtView(scene: .judging(beat, summary))
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)

            log

            Text(L10n.thinkingPremiumHelper(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.muted)
                .frame(maxWidth: 360, alignment: .leading)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .paperSurface(radius: Radius.card)
        .cardShadow()
    }

    /// Ticked lines for what is done, the last one live until the story is
    /// over. VoiceOver hears the live line announced, not the list.
    private var log: some View {
        let lines = self.lines
        let over = beat == .finale
        return VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                let live = index == lines.count - 1 && !over
                HStack(alignment: .top, spacing: 10) {
                    mark(live: live)
                    Text(Story.text(line, lang: lang))
                        .brandText(TypeStyle(face: .inter, weight: live ? 500 : 400, size: 14, lineHeight: 1.4, textStyle: .subheadline))
                        .foregroundStyle(live ? Brand.ink : Brand.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .transition(.opacity.combined(with: .offset(y: 6)))
            }
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.3), value: lines.count)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(liveText)
    }

    private func mark(live: Bool) -> some View {
        Group {
            if live {
                LiveDots(animated: !reduceMotion)
                    .foregroundStyle(Brand.ink)
            } else {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Brand.sageInk)
            }
        }
        .frame(width: 18, height: 20)
    }

    /// While waiting, follows the clock; once the verdict is in, plays the
    /// plan out and hands over at its end.
    private func run() async {
        if !done {
            // Stills (screenshots, tests) stay on the first line.
            guard sceneLive else { return }
            while !Task.isCancelled {
                waiting = Story.waitingAt(Date.now.timeIntervalSince(started) * 1000, acceptedAt: acceptedMs)
                try? await Task.sleep(for: .milliseconds(250))
            }
            return
        }
        let ending = Story.ending(fromWaiting: waiting, summary: summary, reduced: reduceMotion || scenePhase != .active)
        plan = ending
        let began = Date.now
        do {
            for (index, step) in ending.steps.enumerated() {
                try await pause(until: step.at, since: began)
                reached = index + 1
            }
            try await pause(until: ending.finishAt, since: began)
        } catch {
            return
        }
        onFinished()
    }

    private func pause(until ms: Int, since began: Date) async throws {
        let left = ms - Int(Date.now.timeIntervalSince(began) * 1000)
        if left > 0 { try await Task.sleep(for: .milliseconds(left)) }
    }
}

/// Three dots that pulse one after the other.
private struct LiveDots: View {
    let animated: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1, paused: !animated)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { index in
                    let wave = 0.5 + 0.5 * sin(2 * Double.pi * (t - Double(index) * 0.15))
                    Circle()
                        .frame(width: 4, height: 4)
                        .opacity(animated ? 0.25 + 0.75 * wave : 0.6)
                }
            }
        }
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
