import SwiftUI

/// Home, laid out like a chat: what has been added so far fills the page
/// above, the box to write in is pinned to the bottom with its send button,
/// and the other side comes as a card above it or as a link. The box holds
/// the text, "Add context" and the counter; picked images show just above it.
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

    private enum Field: Hashable {
        case mine, theirs
        /// Sides C and D, by position in `home.more`.
        case extra(Int)
    }

    private static let errorID = "home.error"
    private static let clarifyID = "home.clarify"
    private static let linkType = TypeStyle(face: .inter, weight: 600, size: 13, lineHeight: 1.2, textStyle: .footnote, maxScale: 1.8)

    var body: some View {
        @Bindable var home = app.home
        let lang = app.lang
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
        .background(Brand.ivory.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Brand.ivory, for: .navigationBar)
        .toolbar {
            if home.clarify == nil {
                RootBarLeading()
                RootBarTrailing()
            }
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

    /// Everything but the box in use, from the bottom up. Two sides go to
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
                        HomeCourt(busy: home.isBusy, covered: pageCovered || home.isJudging || !home.path.isEmpty)
                    }
            }
            // Every open card but the last, which is the composer at the bottom.
            ForEach(home.theirsOpen ? Array(home.openSides.dropLast()) : [], id: \.self) { side in
                sideCard(lang, home: home, side: side, inComposer: false)
            }
            if app.evidenceOn, !home.evidence.items.isEmpty || home.evidence.overLimit || home.evidence.failure != nil {
                VStack(alignment: .leading, spacing: 10) {
                    EvidenceRows(evidence: home.evidence, lang: lang, disabled: home.isBusy)
                    EvidenceNotes(evidence: home.evidence, lang: lang)
                }
            }
            if let error = home.error {
                errorBanner(error, lang: lang)
                    .id(Self.errorID)
            }
            if home.offersExample || !home.isBlank {
                footer(lang, home: home)
            }
            if !home.theirsOpen {
                otherSide(lang, home: home)
            } else if home.canAddSide(app) || home.canSendLink(app) {
                moreSides(lang, home: home)
            }
        }
    }

    /// The box that was opened last, and under it what is left to spend.
    private func composer(_ lang: AppLang, home: HomeModel) -> some View {
        // The gap is the glow's radius (12) plus 8, so it never touches the line.
        VStack(spacing: 20) {
            sideCard(lang, home: home, side: home.openSides.last ?? .a, inComposer: true)
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

    private func sideCard(_ lang: AppLang, home: HomeModel, side: Party, inComposer: Bool) -> some View {
        let focus = field(for: side)
        let mine = side == .a
        let colors = sides.of(side)
        let title = mine ? L10n.appHomeYourSide(lang) : (side == .b ? L10n.appHomeTheirSide(lang) : side.label(lang))
        let removable = side == home.openSides.last && side != .a
        return VStack(alignment: .leading, spacing: 8) {
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
                }
            }
            editor(
                text(of: side, home: home),
                field: focus,
                placeholder: mine ? L10n.appHomeYourPlaceholder(lang) : L10n.appHomeTheirPlaceholder(lang),
                label: mine ? L10n.appHomeYourSideLabel(lang) : (side == .b ? L10n.appHomeTheirSideLabel(lang) : title),
                lines: inComposer ? 2...(typeSize.isAccessibilitySize ? 4 : 7) : 3...8
            )
            .disabled(home.isBusy)
            bottomRow(lang, home: home, inComposer: inComposer)
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .neonEdge(colors.strong, focused: focused == focus, radius: Radius.block)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }

    /// Under the text: "Add context" on the left, and in the composer the
    /// counter and the send button on the right. Every box adds to the same
    /// set of images.
    private func bottomRow(_ lang: AppLang, home: HomeModel, inComposer: Bool) -> some View {
        HStack(alignment: .center, spacing: 12) {
            if app.evidenceOffered, !home.evidence.full {
                EvidenceAddButton(evidence: home.evidence, disabled: home.isBusy) {
                    Label(L10n.appHomeAddContext(lang), systemImage: "paperclip")
                        .brandText(Self.linkType)
                        .foregroundStyle(Brand.ink2)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
            if inComposer {
                counter(lang, home: home)
                    .fixedSize()
                sendButton(lang, home: home)
                    .padding(.trailing, -6)
            }
        }
    }

    private func sendButton(_ lang: AppLang, home: HomeModel) -> some View {
        // `blockedUntil` is cleared by the model when a rate limit ends.
        let waiting = home.isCheckingQuestions || home.isCreatingCase
        let enabled = home.canSubmit(app) || waiting
        return Button {
            // Still enabled while waiting so the spinner isn't dimmed; a
            // tap then must not turn a case being created into a verdict.
            guard home.canSubmit(app) else { return }
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
        .disabled(!enabled)
        .accessibilityLabel(L10n.getVerdict(lang))
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

    private func editor(_ text: Binding<String>, field: Field, placeholder: String, label: String, lines: ClosedRange<Int>) -> some View {
        let style = TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5)
        // The editor font stops scaling at 2.2x, so the line height must too.
        let line = min(lineHeight, 22.5 * style.maxScale)
        // TextEditor has no height of its own, so an invisible copy of the
        // text sets it (the placeholder while empty, which can wrap). The
        // zero-width space keeps the empty line after a trailing newline.
        return Text(text.wrappedValue.isEmpty ? placeholder : text.wrappedValue + "\u{200B}")
            .brandText(style)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(minHeight: line * CGFloat(lines.lowerBound), maxHeight: line * CGFloat(lines.upperBound), alignment: .top)
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
            Task { focused = .extra(home.more.count - 1) }
        } label: {
            Label(L10n.homeAddSide(lang), systemImage: "plus")
                .frame(minHeight: 44)
        }
        .buttonStyle(GhostButtonStyle())
        .disabled(home.isBusy || !home.canAddSide(app))
    }

    private func addTheirSide(_ lang: AppLang, home: HomeModel) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { home.addTheirSide() }
            // The card has to be on screen before it can take the focus.
            Task { focused = .theirs }
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

    private func footer(_ lang: AppLang, home: HomeModel) -> some View {
        FlowLayout(spacing: 16) {
            if home.offersExample {
                exampleButton(lang, home: home)
            }
            if !home.isBlank {
                clearButton(lang, home: home)
            }
        }
        .padding(.horizontal, 4)
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
                .brandText(Self.linkType)
                .foregroundStyle(Brand.ink2)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
        app.home.submit(app: app)
    }
}
