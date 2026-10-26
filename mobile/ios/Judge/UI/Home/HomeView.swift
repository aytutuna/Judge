import SwiftData
import SwiftUI

/// Home as the web's empty thread (components/thread/Composer.tsx): one case
/// file card with the argument, the lens, the tier and the send button,
/// then the newest saved verdicts and the privacy note.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @SceneStorage("home.draft") private var draft = ""
    @State private var webLink: WebLink?
    @State private var lensOpen = false
    @FocusState private var editorFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sceneLive) private var sceneLive

    private static let errorID = "home.error"
    private static let clarifyID = "home.clarify"

    var body: some View {
        @Bindable var home = app.home
        let lang = app.lang
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header(lang)
                    if let clarify = home.clarify {
                        // Premium's questions take the card's place.
                        ClarifyCard(home: home, state: clarify, lang: lang)
                            .id(Self.clarifyID)
                    } else {
                        caseCard(lang, home: home)
                    }
                    RecentSection(lang: lang)
                    footer(lang)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 32)
            }
            .onAppear {
                if home.error != nil { proxy.scrollTo(Self.errorID, anchor: .center) }
            }
            .task {
                // Screenshot states open on the part they show.
                guard let target = home.initialScroll else { return }
                try? await Task.sleep(for: .milliseconds(300))
                proxy.scrollTo(target, anchor: .top)
            }
            .onChange(of: home.error) { _, error in
                guard error != nil else { return }
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                    proxy.scrollTo(Self.errorID, anchor: .center)
                }
            }
            .onChange(of: home.clarify != nil) { _, shown in
                guard shown else { return }
                editorFocused = false
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.3)) {
                    proxy.scrollTo(Self.clarifyID, anchor: .top)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        // Keeps scrolled content out from under the status bar, since the nav bar is hidden.
        .safeAreaInset(edge: .top, spacing: 0) {
            Color.clear
                .frame(height: 0)
                .background(Brand.ivory2)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .background(Brand.ivory2.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            if app.persistsDraft, home.argument.isEmpty, !draft.isEmpty { home.argument = draft }
        }
        .onChange(of: home.argument) { _, value in
            let capped = HomeModel.capped(value)
            if capped != value { home.argument = capped }
            if app.persistsDraft { draft = capped }
        }
        .onChange(of: home.preset) { _, value in app.rememberPreset(value) }
        .fullScreenCover(isPresented: $home.isJudging) {
            JudgingCover(home: home, lang: lang)
                .environment(\.sceneLive, sceneLive)
        }
        .sheet(item: $webLink) { link in
            SafariView(url: link.url).ignoresSafeArea()
        }
    }

    private func header(_ lang: AppLang) -> some View {
        HStack(spacing: 10) {
            BrandMark(width: 30)
            Text(L10n.appName(lang))
                .brandText(.brand)
                .foregroundStyle(Brand.ink)
            Spacer()
            LangToggle(lang: lang) { app.setLangPreference($0 == .en ? .en : .tr) }
        }
        .padding(.top, 8)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
    }

    private func caseCard(_ lang: AppLang, home: HomeModel) -> some View {
        let twoSided = home.isTwoSided(app)
        return VStack(alignment: .leading, spacing: 18) {
            caseHead(lang, today: home.today ?? .now)
            VStack(alignment: .leading, spacing: 14) {
                editor(lang, home: home, twoSided: twoSided)
                if !twoSided {
                    examples(lang, home: home)
                }
                toolbar(lang, home: home, twoSided: twoSided)
                if lensOpen {
                    presets(lang, home: home)
                }
                if app.tierAvailability != .hidden {
                    TierSwitchView(lang: lang, disabled: home.isBusy) {
                        home.path.append(.pricing)
                    }
                    .id(HomeModel.tierAnchor)
                }
                if app.evidenceOn {
                    EvidencePickerView(evidence: home.evidence, lang: lang, disabled: home.isBusy)
                        .id(HomeModel.evidenceAnchor)
                }
                if twoSided {
                    CaseNameField(home: home, fallback: Names.firstName(app.account.user?.name) ?? "", lang: lang, disabled: home.isBusy)
                }
                if let error = home.error {
                    errorBanner(error, lang: lang)
                        .id(Self.errorID)
                }
                submitSection(lang, home: home, twoSided: twoSided)
                if app.casesOn {
                    Button(twoSided ? L10n.homeOneSide(lang) : L10n.homeInvite(lang)) {
                        home.mode = twoSided ? .now : .both
                    }
                    .buttonStyle(LinkButtonStyle())
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .disabled(home.isBusy)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 22)
        .paperSurface(radius: Radius.card)
        .cardShadow()
    }

    /// "New case" and today's date, the heading and the three steps.
    private func caseHead(_ lang: AppLang, today: Date) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Kicker(text: L10n.homeKicker(lang))
                Spacer(minLength: 8)
                Text(Recent.dayMonth(today, lang: lang))
                    .brandText(TypeStyle(face: .serifItalic, weight: 400, size: 15, lineHeight: 1.25, textStyle: .subheadline, maxScale: 1.6))
                    .foregroundStyle(Brand.placeholder)
            }
            Text(L10n.homeTitle(lang))
                .brandText(.caseTitle)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            steps(lang)
                .padding(.top, 2)
        }
    }

    private func steps(_ lang: AppLang) -> some View {
        let labels = [L10n.homeStepArgument(lang), L10n.threadLens(lang), L10n.homeStepRuling(lang)]
        return HStack(spacing: 0) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                step(index + 1, label: label, current: index == 0)
                if index < labels.count - 1 {
                    Rectangle()
                        .fill(Brand.line2)
                        .frame(maxWidth: .infinity)
                        .frame(height: 1)
                        .padding(.horizontal, 6)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(labels.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: ", "))
    }

    private func step(_ n: Int, label: String, current: Bool) -> some View {
        HStack(spacing: 6) {
            Text(verbatim: "\(n)")
                .brandText(TypeStyle(face: .inter, weight: 600, size: 11, lineHeight: 1, textStyle: .caption2, maxScale: 1.3))
                .foregroundStyle(current ? Brand.paper : Brand.muted)
                .frame(width: 20, height: 20)
                .background(Circle().fill(current ? Brand.ink : Brand.paper))
                .overlay(Circle().strokeBorder(current ? Brand.ink : Brand.line2, lineWidth: 1))
            Text(label)
                .brandText(TypeStyle(face: .inter, weight: 500, size: 12, lineHeight: 1.2, textStyle: .caption2, maxScale: 1.4))
                .foregroundStyle(current ? Brand.ink : Brand.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }

    private func editor(_ lang: AppLang, home: HomeModel, twoSided: Bool) -> some View {
        @Bindable var home = home
        return ZStack(alignment: .topLeading) {
            TextEditor(text: $home.argument)
                .focused($editorFocused)
                .brandText(.body)
                .foregroundStyle(Brand.ink)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 150)
                .padding(.horizontal, 11)
                .padding(.vertical, 6)
                .accessibilityLabel(L10n.inputLabel(lang))
            if home.argument.isEmpty {
                Text(twoSided ? L10n.threadPlaceholderTwoSided(lang) : L10n.threadPlaceholder(lang))
                    .brandText(.body)
                    .foregroundStyle(Brand.placeholder)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .paperSurface(radius: Radius.field, fill: Brand.ivory, border: editorFocused ? Brand.terraInk : Brand.line2)
    }

    private func examples(_ lang: AppLang, home: HomeModel) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(ExampleArgument.all) { example in
                    let text = example.text(lang)
                    Button(example.label(lang)) {
                        home.argument = HomeModel.capped(text)
                    }
                    .buttonStyle(ExampleChipStyle(selected: home.argument == text))
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L10n.examplesLabel(lang))
    }

    private func toolbar(_ lang: AppLang, home: HomeModel, twoSided: Bool) -> some View {
        let length = home.length
        return HStack(spacing: 8) {
            lensChip(lang, home: home)
            if twoSided {
                Text(L10n.caseKicker(lang))
                    .brandText(TypeStyle(face: .inter, weight: 500, size: 12, lineHeight: 1.2, textStyle: .caption2, maxScale: 1.6))
                    .foregroundStyle(Brand.sageInk)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Brand.sageTint))
            }
            Spacer(minLength: 8)
            Text(L10n.appInputCounter(lang, count: String(length), max: String(HomeModel.maxLength)))
                .brandText(.footnote)
                .monospacedDigit()
                .foregroundStyle(length > HomeModel.warnLength ? Brand.terraInk : Brand.muted)
                .lineLimit(1)
        }
    }

    /// "The lens · Fairness": opens the presets under the toolbar.
    private func lensChip(_ lang: AppLang, home: HomeModel) -> some View {
        let preset = Preset.find(home.preset)
        return Button {
            withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { lensOpen.toggle() }
        } label: {
            HStack(spacing: 6) {
                Text(preset.emoji)
                Text(L10n.threadLens(lang))
                    .foregroundStyle(lensOpen ? Brand.ink : Brand.ink2)
                Text("· " + preset.label(lang))
                    .foregroundStyle(lensOpen ? Brand.ink2 : Brand.muted)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Brand.ink2)
                    .rotationEffect(.degrees(lensOpen ? 180 : 0))
            }
            .brandText(TypeStyle(face: .inter, weight: 500, size: 13, lineHeight: 1.2, textStyle: .footnote, maxScale: 1.8))
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(Capsule().fill(lensOpen ? Brand.ivory2 : Brand.paper))
            .overlay(Capsule().strokeBorder(Brand.line2, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(home.isBusy)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.threadLens(lang))
        .accessibilityValue(preset.label(lang))
        .accessibilityAddTraits(.isButton)
    }

    private func presets(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            FlowLayout(spacing: 8, rowSpacing: 8) {
                ForEach(Preset.all) { preset in
                    presetChip(preset, lang: lang, home: home)
                }
            }
            Text(Preset.find(home.preset).blurb(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func presetChip(_ preset: Preset, lang: AppLang, home: HomeModel) -> some View {
        let selected = preset.id == home.preset
        let title = preset.emoji + " " + preset.label(lang)
        return Button(title) { home.preset = preset.id }
            .buttonStyle(ChipButtonStyle(selected: selected))
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func errorBanner(_ error: APIError, lang: AppLang) -> some View {
        let retry: (() -> Void)? = error.offersRetry ? { submit() } : nil
        return ErrorBanner(
            message: ErrorText.message(error, lang: lang),
            retryTitle: error.offersRetry ? L10n.appRetry(lang) : nil,
            onRetry: retry
        )
    }

    private func submitSection(_ lang: AppLang, home: HomeModel, twoSided: Bool) -> some View {
        VStack(spacing: 12) {
            // `blockedUntil` is cleared by the model when a rate limit ends.
            let waiting = home.isCheckingBot || home.isCheckingQuestions || home.isCreatingCase
            let title = twoSided ? L10n.caseCreate(lang) : L10n.getVerdict(lang)
            Button { submit() } label: {
                if waiting {
                    // The bot check (free), the questions (premium) or the
                    // new case run before anything else goes up.
                    ProgressView()
                        .tint(Brand.paper)
                        .accessibilityLabel(title)
                } else {
                    HStack(spacing: 10) {
                        Text(title)
                            .lineLimit(1)
                        Image(systemName: "arrow.right")
                            .font(.system(size: 16, weight: .semibold))
                            .accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(SubmitButtonStyle())
            .disabled(!home.canSubmit(evidenceOn: app.evidenceOn) && !waiting)
            .padding(.top, 4)
            if home.isCheckingQuestions || home.isCreatingCase {
                Text(home.isCreatingCase ? L10n.caseCreating(lang) : L10n.tierChecking(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
    }

    private func footer(_ lang: AppLang) -> some View {
        VStack(spacing: 10) {
            VStack(spacing: 2) {
                Text(L10n.privacyNote(lang))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
                Button(L10n.privacyLink(lang)) {
                    webLink = WebLink(url: app.config.siteURL("privacy"))
                }
                .buttonStyle(LinkButtonStyle())
            }
            Text(L10n.footerNote(lang))
                .brandText(.footnote)
                .foregroundStyle(Brand.muted)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 8)
    }

    private func submit() {
        editorFocused = false
        app.home.submit(app: app)
    }
}

/// "Recent" under the case card: the newest saved verdicts in a row of small
/// cards, with a link to the whole list. Nothing at all while it is empty.
private struct RecentSection: View {
    @Environment(AppModel.self) private var app
    @Query(RecentSection.latest) private var saved: [SavedVerdict]
    let lang: AppLang

    static var latest: FetchDescriptor<SavedVerdict> {
        var descriptor = FetchDescriptor<SavedVerdict>(sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
        descriptor.fetchLimit = Recent.limit
        return descriptor
    }

    var body: some View {
        let cards = Recent.cards(saved, lang: lang, now: app.home.today ?? .now)
        if !cards.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Kicker(text: L10n.homeRecent(lang))
                        .accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button(L10n.homeAll(lang)) {
                        app.historySegment = .verdicts
                        app.tab = .history
                    }
                    .buttonStyle(LinkButtonStyle())
                }
                .padding(.horizontal, 20)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(cards) { card in
                            Button {
                                app.home.path.append(.saved(id: card.id))
                            } label: {
                                RecentCardView(card: card, lang: lang)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 4)
                    .padding(.bottom, 14)
                }
            }
            .padding(.horizontal, -16)
        }
    }
}

private struct RecentCardView: View {
    let card: Recent.Card
    let lang: AppLang

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(text: L10n.homeDecided(lang), color: Brand.terraInk)
            Text(card.title)
                .brandText(TypeStyle(face: .inter, weight: 500, size: 13, lineHeight: 1.35, textStyle: .footnote))
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(.leading)
                .lineLimit(2, reservesSpace: true)
            Text(card.date)
                .brandText(.footnote)
                .foregroundStyle(Brand.placeholder)
                .padding(.top, 2)
        }
        .padding(.horizontal, 14)
        .padding(.top, 14)
        .padding(.bottom, 12)
        .frame(width: 180, alignment: .leading)
        .paperSurface(radius: Radius.field)
        .softShadow()
        .contentShape(RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// An example under the field: small, paper, outlined in ink once picked.
private struct ExampleChipStyle: ButtonStyle {
    var selected = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(TypeStyle(face: .inter, weight: 500, size: 12.5, lineHeight: 1.2, textStyle: .footnote, maxScale: 1.8))
            .foregroundStyle(selected ? Brand.ink : Brand.ink2)
            .lineLimit(1)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background(Capsule().fill(Brand.paper))
            .overlay(Capsule().strokeBorder(selected ? Brand.ink : Brand.line2, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// The case card's send button (thread.module.css .submit).
private struct SubmitButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brandText(.button)
            .foregroundStyle(Brand.paper)
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 20)
            .background(RoundedRectangle(cornerRadius: Radius.field, style: .continuous).fill(Brand.ink.opacity(isEnabled ? 1 : 0.35)))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}
