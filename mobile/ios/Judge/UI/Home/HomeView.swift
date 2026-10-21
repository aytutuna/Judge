import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var app
    @SceneStorage("home.draft") private var draft = ""
    @State private var webLink: WebLink?
    @FocusState private var editorFocused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let errorID = "home.error"
    private static let clarifyID = "home.clarify"

    var body: some View {
        @Bindable var home = app.home
        let lang = app.lang
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header(lang)
                    hero(lang)
                    if let clarify = home.clarify {
                        // Premium's questions take the form's place.
                        ClarifyCard(home: home, state: clarify, lang: lang)
                            .id(Self.clarifyID)
                    } else {
                        formCard(lang, home: home)
                    }
                    Text(L10n.footerNote(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                        .padding(.top, 4)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 32)
            }
            .onAppear {
                if home.error != nil { proxy.scrollTo(Self.errorID, anchor: .center) }
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
                .background(Brand.ivory)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .background(Brand.ivory.ignoresSafeArea())
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
        .accessibilityElement(children: .contain)
    }

    private func hero(_ lang: AppLang) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Kicker(text: L10n.heroEyebrow(lang))
            VStack(alignment: .leading, spacing: 0) {
                Text(L10n.heroTitleLine1(lang))
                    .brandText(.display1)
                    .foregroundStyle(Brand.ink)
                Text(L10n.heroTitleLine2(lang))
                    .brandText(.heroSerif)
                    .foregroundStyle(Brand.terra)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Text(L10n.heroLead(lang))
                .brandText(.lead)
                .foregroundStyle(Brand.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func formCard(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            editorSection(lang, home: home)
            examplesSection(lang, home: home)
            presetSection(lang, home: home)
            if app.tierAvailability != .hidden {
                TierSwitchView(lang: lang, disabled: home.isBusy) {
                    home.path.append(.pricing)
                }
            }
            if app.evidenceOn {
                EvidencePickerView(evidence: home.evidence, lang: lang, disabled: home.isBusy)
            }
            if let error = home.error {
                errorBanner(error, lang: lang)
                    .id(Self.errorID)
            }
            submitSection(lang, home: home)
        }
        .padding(20)
        .paperSurface(radius: Radius.card)
        .cardShadow()
    }

    private func editorSection(_ lang: AppLang, home: HomeModel) -> some View {
        @Bindable var home = home
        let length = home.length
        let warn = length > HomeModel.warnLength
        return VStack(alignment: .leading, spacing: 8) {
            Text(L10n.inputLabel(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            ZStack(alignment: .topLeading) {
                TextEditor(text: $home.argument)
                    .focused($editorFocused)
                    .brandText(.body)
                    .foregroundStyle(Brand.ink)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 180)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .accessibilityLabel(L10n.inputLabel(lang))
                if home.argument.isEmpty {
                    Text(L10n.placeholder(lang))
                        .brandText(.body)
                        .foregroundStyle(Brand.placeholder)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 16)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .paperSurface(radius: Radius.field, fill: Brand.paper, border: editorFocused ? Brand.terraInk : Brand.line2)
            HStack {
                Spacer()
                Text(L10n.appInputCounter(lang, count: String(length), max: String(HomeModel.maxLength)))
                    .brandText(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(warn ? Brand.terraInk : Brand.muted)
            }
        }
    }

    private func examplesSection(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.examplesLabel(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
            FlowLayout(spacing: 8, rowSpacing: 8) {
                ForEach(ExampleArgument.all) { example in
                    Button(example.label(lang)) {
                        home.argument = HomeModel.capped(example.text(lang))
                    }
                    .buttonStyle(ChipButtonStyle())
                }
            }
        }
    }

    private func presetSection(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L10n.judgeBy(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            FlowLayout(spacing: 8, rowSpacing: 8) {
                ForEach(Preset.all) { preset in
                    presetChip(preset, lang: lang, home: home)
                }
            }
            Text(Preset.find(home.preset).blurb(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
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

    private func submitSection(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(spacing: 12) {
            // `blockedUntil` is cleared by the model when a rate limit ends.
            let waiting = home.isCheckingBot || home.isCheckingQuestions
            Button { submit() } label: {
                if waiting {
                    // The bot check (free) or the questions (premium) run
                    // before the judging cover goes up.
                    ProgressView()
                        .tint(Brand.ivory)
                        .accessibilityLabel(L10n.getVerdict(lang))
                } else {
                    Text(L10n.getVerdict(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!home.canSubmit(evidenceOn: app.evidenceOn) && !waiting)
            if home.isCheckingQuestions {
                Text(L10n.tierChecking(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            VStack(spacing: 2) {
                Text(L10n.privacyNote(lang))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
                Button(L10n.privacyLink(lang)) {
                    webLink = WebLink(url: app.config.siteURL("privacy"))
                }
                .buttonStyle(LinkButtonStyle())
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
    }

    private func submit() {
        editorFocused = false
        app.home.submit(app: app)
    }
}
