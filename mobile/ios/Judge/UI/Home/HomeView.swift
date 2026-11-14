import SwiftUI
import UIKit

/// Home, laid out like a chat: the boxes fill the page, in order, with "Add
/// context" and the picked images just under them, then the buttons to add
/// a side, and "Clear" at the very bottom. Only the send row (the counter
/// and the send button) is pinned. With one side the box is written in where
/// it stands; with more the boxes only show their text. A tap lifts that
/// side's box above the keyboard to write in; drag it any way and let go
/// with some speed to throw it back, or tap the dim page.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @SceneStorage("home.draft") private var draft = ""
    @SceneStorage("home.draftOther") private var draftOther = ""
    @FocusState private var focused: Field?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sceneLive) private var sceneLive
    @Environment(\.pageCovered) private var pageCovered
    @Environment(\.sides) private var sides
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var lineHeight: CGFloat = 22.5
    /// The side whose box is lifted above the keyboard.
    @State private var active: Party?
    /// True from the lift until the keyboard is gone, so the page doesn't jump while it leaves.
    @State private var pinned = false
    @State private var drag: CGSize = .zero
    /// True from the throw until the next lift: the box is flying off, or gone.
    @State private var thrown = false
    /// Where each box sits on screen, read when one is lifted; not state, so scrolling doesn't redraw.
    @State private var frames = FrameBox()
    /// Boxes lit up by a send that is missing their text.
    @State private var flashing: Set<Party> = []

    private enum Field: Hashable {
        case mine, theirs
        /// Sides C and D, by position in `home.more`.
        case extra(Int)
    }

    private enum CardKind { case list, lifted }

    @MainActor private final class FrameBox {
        var values: [Party: CGRect] = [:]
    }

    private struct CardFrames: PreferenceKey {
        static let defaultValue: [Party: CGRect] = [:]
        static func reduce(value: inout [Party: CGRect], nextValue: () -> [Party: CGRect]) {
            value.merge(nextValue()) { $1 }
        }
    }

    private static let errorID = "home.error"
    private static let clarifyID = "home.clarify"
    private static let linkType = TypeStyle(face: .inter, weight: 600, size: 13, lineHeight: 1.2, textStyle: .footnote, maxScale: 1.8)

    var body: some View {
        @Bindable var home = app.home
        let lang = app.lang
        ZStack(alignment: .bottom) {
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    if let clarify = home.clarify {
                        // The clarifying questions take the form's place.
                        ClarifyCard(home: home, state: clarify, lang: lang)
                            .id(Self.clarifyID)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                            .padding(.bottom, 32)
                    } else {
                        form(lang, home: home)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                            .padding(.bottom, 12)
                            .frame(minHeight: geo.size.height, alignment: .bottom)
                    }
                }
                .defaultScrollAnchor(home.clarify == nil ? UnitPoint.bottom : UnitPoint.top)
                .scrollDismissesKeyboard(.interactively)
                .onAppear {
                    if home.error != nil { proxy.scrollTo(Self.errorID, anchor: .center) }
                }
                .onChange(of: home.error) { _, error in
                    guard let error else { return }
                    app.analytics.track("error_shown", ["code": error.eventCode])
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                        proxy.scrollTo(Self.errorID, anchor: .center)
                    }
                }
                .onChange(of: home.clarify != nil) { _, shown in
                    guard shown else { return }
                    focused = nil
                    active = nil
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                        proxy.scrollTo(Self.clarifyID, anchor: .top)
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if home.clarify == nil {
                composer(lang, home: home)
            }
        }
        // The page stays where it is while a box is lifted above the keyboard.
        .ignoresSafeArea(.keyboard, edges: pinned ? .bottom : Edge.Set())
        lifted(lang, home: home)
        }
        .background(Brand.ivory.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .clearBar()
        .toolbar {
            if home.clarify == nil {
                RootBarLeading(locked: active != nil)
                RootBarTrailing(locked: active != nil)
            }
        }
        .onPreferenceChange(CardFrames.self) { [frames] value in
            MainActor.assumeIsolated { frames.values = value }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            if active != nil, !thrown, !app.sheetOpen { dismiss() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
            if active == nil { pinned = false }
        }
        .onChange(of: active) { _, side in
            guard side == nil else { return }
            // No keyboard to wait for (a hardware keyboard, say).
            Task {
                try? await Task.sleep(for: .seconds(1))
                if active == nil { pinned = false }
            }
        }
        .onChange(of: app.sheetOpen) { _, open in
            if !open, let side = active { focused = field(for: side) }
        }
        .onTabAppear { app.analytics.track("screen_view", ["screen": "home"]) }
        .onAppear {
            guard app.persistsDraft else { return }
            if home.argument.isEmpty, !draft.isEmpty { home.argument = draft }
            if home.otherSide.isEmpty, !draftOther.isEmpty {
                home.otherSide = draftOther
                home.theirsOpen = true
            }
        }
        .onChange(of: home.argument) { old, value in
            if old.isEmpty, !value.isEmpty { app.analytics.track("case_started") }
            let capped = HomeModel.capped(value)
            if capped != value { home.argument = capped }
            if app.persistsDraft { draft = capped }
        }
        .onChange(of: home.otherSide) { _, value in
            let capped = HomeModel.capped(value)
            if capped != value { home.otherSide = capped }
            if app.persistsDraft { draftOther = capped }
            // A failed "send them a link" leaves the case mode on, and "Try
            // again" would then open a case without the side just written.
            if home.mode == .both, !capped.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                home.mode = .now
            }
        }
        .fullScreenCover(isPresented: $home.isJudging) {
            JudgingCover(home: home, lang: lang, gamify: app.gamify)
                .environment(\.sceneLive, sceneLive)
        }
        .sheet(item: $home.shareLink) { link in
            ActivityView(items: [L10n.caseInviteShareText(lang), link.url]) {
                home.shareLink = nil
                app.sheetOpen = false
            }
                .presentationDetents([.medium, .large])
                .ignoresSafeArea()
        }
        .onChange(of: home.shareLink != nil) { _, open in
            app.sheetOpen = open
        }
    }

    /// The boxes and everything under them. Two sides go to
    /// the judges as one text with a name in front of each, and a link makes
    /// a two-sided case instead. Screenshots go with the whole case, not
    /// with one card: the judges get them as one set.
    private func form(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if app.gamify {
                // Takes what the boxes leave, never less than the court needs
                // to draw: the page scrolls before the court shrinks.
                Color.clear
                    .frame(maxWidth: .infinity, minHeight: HomeCourt.minHeight)
                    .overlay {
                        HomeCourt(busy: home.isBusy, covered: pageCovered || home.isJudging || !home.path.isEmpty, venue: home.homeVenue)
                    }
            }
            ForEach(home.openSides, id: \.self) { side in
                sideCard(lang, home: home, side: side, kind: .list)
            }
            if app.evidenceOffered {
                contextBlock(lang, home: home)
            }
            if !home.theirsOpen {
                otherSide(lang, home: home)
            } else if home.more.count < HomeModel.maxSides - 2 {
                moreSides(lang, home: home)
            }
            if let error = home.error {
                errorBanner(error, lang: lang)
                    .id(Self.errorID)
            }
            if home.offersExample {
                exampleButton(lang, home: home)
                    .padding(.horizontal, 4)
            }
            if !home.isBlank {
                clearButton(lang, home: home)
            }
        }
    }

    /// "Add context" under the boxes, and the images picked so far under it.
    private func contextBlock(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if app.evidenceOffered, !home.evidence.full {
                EvidenceAddButton(evidence: home.evidence, disabled: home.isBusy) {
                    Label(L10n.appHomeAddContext(lang), systemImage: "paperclip")
                        .brandText(Self.linkType)
                        .foregroundStyle(Brand.ink2)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 4)
            }
            if app.evidenceOn, !home.evidence.items.isEmpty || home.evidence.overLimit || home.evidence.failure != nil {
                EvidenceRows(evidence: home.evidence, lang: lang, disabled: home.isBusy)
                EvidenceNotes(evidence: home.evidence, lang: lang)
            }
        }
    }

    /// The send row, and under it what is left to spend.
    private func composer(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(spacing: 4) {
            bottomRow(lang, home: home)
            if home.isCheckingQuestions || home.isCreatingCase {
                Text(home.isCreatingCase ? L10n.caseCreating(lang) : L10n.tierChecking(lang))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .accessibilityAddTraits(.updatesFrequently)
            } else if app.account.isSignedIn, let entitlement = app.account.entitlement {
                Text(Balance(entitlement).line(lang))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        // The boxes scroll under the send row, so it needs its own ground.
        .background(Brand.ivory.ignoresSafeArea(edges: .bottom))
    }

    private func field(for side: Party) -> Field {
        switch side {
        case .a, .unknown: return .mine
        case .b: return .theirs
        case .c: return .extra(0)
        case .d: return .extra(1)
        }
    }

    /// The text of a card: yours, theirs, or one of the extra sides (capped like the rest).
    private func text(of side: Party, home: HomeModel) -> Binding<String> {
        let index = side == .c ? 0 : 1
        switch side {
        case .a, .unknown: return Binding(get: { home.argument }, set: { home.argument = $0 })
        case .b: return Binding(get: { home.otherSide }, set: { home.otherSide = $0 })
        case .c, .d:
            return Binding(
                get: { home.more.indices.contains(index) ? home.more[index].text : "" },
                set: { if home.more.indices.contains(index) { home.more[index].text = HomeModel.capped($0) } }
            )
        }
    }

    private func name(of side: Party, home: HomeModel) -> Binding<String?> {
        let index = side == .c ? 0 : 1
        switch side {
        case .a, .unknown: return Binding(get: { home.caseName }, set: { home.caseName = $0 })
        case .b: return Binding(get: { home.otherName }, set: { home.otherName = $0 })
        case .c, .d:
            return Binding(
                get: { home.more.indices.contains(index) ? home.more[index].name : nil },
                set: { if home.more.indices.contains(index) { home.more[index].name = $0 } }
            )
        }
    }

    private func sideCard(_ lang: AppLang, home: HomeModel, side: Party, kind: CardKind, room: CGFloat = 0) -> some View {
        let focus = field(for: side)
        let lifted = kind == .lifted
        // With one side the box is written in where it stands.
        let writes = lifted || !home.theirsOpen
        let mine = side == .a
        let colors = sides.of(side)
        let title = mine ? L10n.appHomeYourSide(lang) : (side == .b ? L10n.appHomeTheirSide(lang) : side.label(lang))
        let removable = side == home.openSides.last && side != .a && !lifted
        let placeholder = mine ? L10n.appHomeYourPlaceholder(lang) : L10n.appHomeTheirPlaceholder(lang)
        let label = mine ? L10n.appHomeYourSideLabel(lang) : (side == .b ? L10n.appHomeTheirSideLabel(lang) : title)
        let range = kind == .list ? 3...8 : 2...(typeSize.isAccessibilitySize ? 4 : 7)
        return VStack(alignment: .leading, spacing: 8) {
            if lifted {
                Capsule()
                    .fill(Brand.line)
                    .frame(width: 36, height: 5)
                    .frame(maxWidth: .infinity, minHeight: 16)
                    .contentShape(Rectangle())
                    .gesture(throwDrag)
                    .accessibilityHidden(true)
            }
            // Names only tell two sides apart.
            if home.theirsOpen {
                HStack(spacing: 8) {
                    PartyAvatar(party: side)
                    CaseNameField(
                        name: name(of: side, home: home),
                        fallback: mine ? Names.firstName(app.account.user?.name) ?? "" : "",
                        placeholder: mine ? L10n.appHomeYourName(lang) : L10n.appHomeTheirName(lang),
                        disabled: home.isBusy
                    )
                    if removable {
                        removeSide(lang, home: home, side: side)
                    }
                    if lifted {
                        closeButton(lang)
                    }
                }
                .gesture(throwDrag, including: lifted ? .all : .subviews)
            }
            if writes {
                editor(
                    text(of: side, home: home),
                    field: focus,
                    placeholder: placeholder,
                    label: label,
                    lines: range,
                    room: lifted ? room : nil
                )
                .disabled(home.isBusy)
            } else {
                preview(text(of: side, home: home).wrappedValue, placeholder: placeholder, label: label, lines: range) {
                    activate(side, home: home)
                }
            }
            if lifted {
                bottomRow(lang, home: home)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, lifted ? 4 : 14)
        .padding(.bottom, 10)
        .background {
            // Behind the editor, so only the gaps and edges throw the box.
            if lifted {
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(throwDrag)
            }
        }
        .neonEdge(colors.strong, focused: lifted || (writes && focused == focus) || flashing.contains(side), radius: Radius.block)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(lifted ? "side.lifted" : "side.card")
        .background {
            if !lifted {
                GeometryReader { geo in
                    Color.clear.preference(key: CardFrames.self, value: [side: geo.frame(in: .global)])
                }
            }
        }
        .opacity(!lifted && active == side ? 0 : 1)
        .accessibilityHidden(!lifted && active == side)
    }

    /// A box that is not being written in: the text, and a tap lifts it.
    private func preview(_ text: String, placeholder: String, label: String, lines: ClosedRange<Int>, open: @escaping () -> Void) -> some View {
        let style = TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5)
        let line = min(lineHeight, 22.5 * style.maxScale)
        return Text(text.isEmpty ? placeholder : text)
            .brandText(style)
            .foregroundStyle(text.isEmpty ? Brand.placeholder : Brand.ink)
            .lineLimit(lines.upperBound)
            .frame(maxWidth: .infinity, minHeight: line * CGFloat(lines.lowerBound), alignment: .topLeading)
            .contentShape(Rectangle())
            .onTapGesture(perform: open)
            .accessibilityLabel(label)
            .accessibilityValue(text)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(.default, open)
    }

    private func closeButton(_ lang: AppLang) -> some View {
        Button(action: dismiss) {
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Brand.ink2)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Brand.ivory2))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.appClose(lang))
    }

    private var openAnimation: Animation {
        reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.4, dampingFraction: 0.86)
    }

    private func activate(_ side: Party, home: HomeModel) {
        guard active == nil, !home.isBusy else { return }
        drag = .zero
        thrown = false
        pinned = true
        withAnimation(openAnimation) { active = side }
        // The box has to be on screen before it can take the focus.
        Task { focused = field(for: side) }
    }

    /// The box goes back to its place in the list and the keyboard goes
    /// with it; the text stays where it was typed.
    private func dismiss() {
        guard active != nil else { return }
        focused = nil
        withAnimation(openAnimation) { active = nil }
    }

    /// The lifted box sits just above the keyboard: this layer is only as
    /// tall as the space the keyboard leaves.
    @ViewBuilder
    private func lifted(_ lang: AppLang, home: HomeModel) -> some View {
        if home.theirsOpen, home.clarify == nil {
            GeometryReader { geo in
                ZStack(alignment: .bottom) {
                    if let side = active, home.openSides.contains(side) {
                        let from = frames.values[side].map { $0.maxY - geo.frame(in: .global).maxY } ?? 0
                        Color.black.opacity(0.2)
                            .ignoresSafeArea()
                            .onTapGesture { dismiss() }
                            .accessibilityHidden(true)
                            .transition(.opacity)
                        sideCard(lang, home: home, side: side, kind: .lifted, room: geo.size.height)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 8)
                            .offset(drag)
                            .opacity(thrown ? 0 : 1)
                            .transition(reduceMotion ? .opacity : .offset(y: from).combined(with: .opacity))
                            .accessibilityAddTraits(.isModal)
                            .accessibilityAction(.escape) { dismiss() }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
            }
        }
    }

    /// The lifted box follows the finger. Far enough, or fast enough, and it
    /// flies off that way; otherwise it springs back.
    private var throwDrag: some Gesture {
        DragGesture(coordinateSpace: .global)
            .onChanged { drag = $0.translation }
            .onEnded { value in
                let pulled = hypot(value.translation.width, value.translation.height)
                let ahead = value.predictedEndTranslation
                let speed = hypot(ahead.width, ahead.height)
                if pulled > 90 || speed > 360 {
                    if speed > 0 { throwAway(toward: ahead, length: speed) } else { throwAway(toward: value.translation, length: pulled) }
                } else {
                    withAnimation(openAnimation) { drag = .zero }
                }
            }
    }

    private func throwAway(toward direction: CGSize, length: CGFloat) {
        focused = nil
        guard !reduceMotion else {
            dismiss()
            drag = .zero
            return
        }
        let side = active
        withAnimation(.easeIn(duration: 0.22)) {
            thrown = true
            drag = CGSize(width: direction.width / length * 900, height: direction.height / length * 900)
        }
        Task {
            try? await Task.sleep(for: .milliseconds(240))
            // A box lifted again in the meantime stays up.
            guard thrown, active == side else { return }
            // Out of sight by now, so it goes back to its spot unseen.
            dismiss()
            drag = .zero
        }
    }

    /// The counter and the send button.
    private func bottomRow(_ lang: AppLang, home: HomeModel) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Spacer(minLength: 0)
            counter(lang, home: home)
                .fixedSize()
            sendButton(lang, home: home)
                .padding(.trailing, -6)
        }
    }

    private func sendButton(_ lang: AppLang, home: HomeModel) -> some View {
        // `blockedUntil` is cleared by the model when a rate limit ends.
        let waiting = home.isCheckingQuestions || home.isCreatingCase
        let enabled = home.canSubmit(app) || waiting
        return Button {
            // Still enabled while waiting so the spinner isn't dimmed; a
            // tap then must not turn a case being created into a verdict.
            guard home.canSubmit(app) else {
                flashShort(home: home)
                return
            }
            home.mode = .now
            submit()
        } label: {
            ZStack {
                Circle().fill(Brand.ink)
                if waiting {
                    // The questions or the new case run before anything
                    // else goes up.
                    ProgressView()
                        .tint(Brand.paper)
                } else {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Brand.paper)
                }
            }
            .frame(width: 38, height: 38)
            .opacity(enabled ? 1 : 0.35)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(home.isBusy && !waiting)
        .accessibilityLabel(L10n.getVerdict(lang))
    }

    /// A send with too little written lights the boxes that need text, as if typed in.
    private func flashShort(home: HomeModel) {
        guard !home.isBusy else { return }
        let texts = [home.argument] + (home.theirsOpen ? [home.otherSide] + home.more.map(\.text) : [])
        let short = zip([Party.a, .b, .c, .d], texts).filter {
            $0.1.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count < HomeModel.minLength
        }.map(\.0)
        guard !short.isEmpty else { return }
        Task {
            let pulses = reduceMotion ? 1 : 2
            for _ in 0..<pulses {
                flashing = Set(short)
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 900 : 350))
                flashing = []
                if !reduceMotion { try? await Task.sleep(for: .milliseconds(200)) }
            }
        }
    }

    /// The card's close button: the second card goes back to one person writing,
    /// a third or fourth just closes.
    private func removeSide(_ lang: AppLang, home: HomeModel, side: Party) -> some View {
        Button {
            focused = nil
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) {
                if side == .b { home.removeTheirSide() } else { home.removeLastSide() }
            }
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Brand.ink2)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Brand.ivory2))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(home.isBusy)
        .accessibilityLabel(L10n.appHomeRemoveTheirSide(lang))
    }

    /// `room` is the height the box may use in all, while lifted; the text grows up to it, then scrolls.
    private func editor(_ text: Binding<String>, field: Field, placeholder: String, label: String, lines: ClosedRange<Int>, room: CGFloat? = nil) -> some View {
        let style = TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5)
        // The editor font stops scaling at 2.2x, so the line height must too.
        let line = min(lineHeight, 22.5 * style.maxScale)
        let tallest = room.map { max(line * CGFloat(lines.lowerBound), $0 - 190) } ?? line * CGFloat(lines.upperBound)
        // TextEditor has no height of its own, so an invisible copy of the
        // text sets it (the placeholder while empty, which can wrap). The
        // zero-width space keeps the empty line after a trailing newline.
        return Text(text.wrappedValue.isEmpty ? placeholder : text.wrappedValue + "\u{200B}")
            .brandText(style)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(minHeight: line * CGFloat(lines.lowerBound), maxHeight: tallest, alignment: .top)
            .fixedSize(horizontal: false, vertical: true)
            .hidden()
            .overlay(alignment: .topLeading) {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: text)
                        .focused($focused, equals: field)
                        .brandText(style)
                        .foregroundStyle(Brand.ink)
                        .scrollContentBackground(.hidden)
                        // TextEditor insets its text; this lines it up with the name above.
                        .padding(.horizontal, -5)
                        .padding(.vertical, -8)
                        .accessibilityLabel(label)
                    if text.wrappedValue.isEmpty {
                        Text(placeholder)
                            .brandText(style)
                            .foregroundStyle(Brand.placeholder)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
            }
    }

    /// The two ways to hear the other side, for whoever has one to add.
    private func otherSide(_ lang: AppLang, home: HomeModel) -> some View {
        // Stacked when the labels don't fit side by side (long locales, big text).
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                addTheirSide(lang, home: home)
                if app.linkOn { sendLink(lang, home: home) }
            }
            VStack(alignment: .leading, spacing: 8) {
                addTheirSide(lang, home: home)
                if app.linkOn { sendLink(lang, home: home) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Under the cards: another side to write, and the link when none of them has text.
    private func moreSides(_ lang: AppLang, home: HomeModel) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                addSide(lang, home: home)
                if app.linkOn, home.canSendLink(app) { sendLink(lang, home: home) }
            }
            VStack(alignment: .leading, spacing: 8) {
                addSide(lang, home: home)
                if app.linkOn, home.canSendLink(app) { sendLink(lang, home: home) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func addSide(_ lang: AppLang, home: HomeModel) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { home.addSide() }
        } label: {
            Label(L10n.homeAddSide(lang), systemImage: "plus")
                .frame(minHeight: 44)
        }
        .buttonStyle(GhostButtonStyle())
        .disabled(home.isBusy)
    }

    private func addTheirSide(_ lang: AppLang, home: HomeModel) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { home.addTheirSide() }
        } label: {
            Label(L10n.appHomeAddTheirSide(lang), systemImage: "plus")
                .frame(minHeight: 44)
        }
        .buttonStyle(GhostButtonStyle())
        .disabled(home.isBusy)
    }

    /// The link means they write it. The case costs a verdict like any other,
    /// and it can go out before anything is written here.
    private func sendLink(_ lang: AppLang, home: HomeModel) -> some View {
        Button {
            focused = nil
            home.sendLink(app: app)
        } label: {
            Label(L10n.appHomeSendLink(lang), systemImage: "link")
                .frame(minHeight: 44)
        }
        .buttonStyle(GhostButtonStyle())
        .disabled(!home.canSendLink(app))
    }

    private func exampleButton(_ lang: AppLang, home: HomeModel) -> some View {
        Button {
            focused = nil
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { home.fillExample(lang: lang) }
        } label: {
            Label(L10n.appHomeExample(lang), systemImage: "shuffle")
                .brandText(Self.linkType)
                .foregroundStyle(Brand.ink2)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(home.isBusy)
    }

    private func clearButton(_ lang: AppLang, home: HomeModel) -> some View {
        Button {
            focused = nil
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { home.judgeAnother() }
        } label: {
            Text(L10n.appHomeClear(lang))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(DangerButtonStyle())
        .disabled(home.isBusy)
    }

    /// The joined text's length against the limit, as the single field had it.
    private func counter(_ lang: AppLang, home: HomeModel) -> some View {
        let length = home.length(app)
        return Text(HomeModel.counterText(length, lang: lang))
            .brandText(.footnote)
            .monospacedDigit()
            .foregroundStyle(length > HomeModel.warnLength ? Brand.terraInk : Brand.muted)
            .lineLimit(1)
    }

    private func errorBanner(_ error: APIError, lang: AppLang) -> some View {
        let retry: (() -> Void)? = error.offersRetry ? { submit() } : nil
        return ErrorBanner(
            message: ErrorText.message(error, lang: lang),
            retryTitle: error.offersRetry ? L10n.appRetry(lang) : nil,
            onRetry: retry
        )
    }

    /// Also "Try again", which repeats whatever was sent last (a verdict or a case).
    private func submit() {
        focused = nil
        active = nil
        app.home.submit(app: app)
    }
}
