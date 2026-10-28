import SwiftUI

/// Home: your side and theirs in two cards and the send button with what
/// is left to spend.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @SceneStorage("home.draft") private var draft = ""
    @SceneStorage("home.draftOther") private var draftOther = ""
    @FocusState private var focused: Field?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.sceneLive) private var sceneLive
    @Environment(\.sides) private var sides

    private enum Field: Hashable {
        case mine, theirs
    }

    private static let errorID = "home.error"
    private static let clarifyID = "home.clarify"

    var body: some View {
        @Bindable var home = app.home
        let lang = app.lang
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header(lang, home: home)
                        .padding(.bottom, -16)
                    if let clarify = home.clarify {
                        // The clarifying questions take the form's place.
                        ClarifyCard(home: home, state: clarify, lang: lang)
                            .id(Self.clarifyID)
                    } else {
                        form(lang, home: home)
                    }
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
                focused = nil
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
            guard app.persistsDraft else { return }
            if home.argument.isEmpty, !draft.isEmpty { home.argument = draft }
            if home.otherSide.isEmpty, !draftOther.isEmpty { home.otherSide = draftOther }
        }
        .onChange(of: home.argument) { _, value in
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
            JudgingCover(home: home, lang: lang)
                .environment(\.sceneLive, sceneLive)
        }
    }

    private func header(_ lang: AppLang, home: HomeModel) -> some View {
        HStack(spacing: 10) {
            Text(L10n.appName(lang))
                .brandText(.brand)
                .foregroundStyle(Brand.ink)
            Spacer()
            // An empty form has nothing for the "+" to clear.
            if !home.isBlank {
                NewArgumentButton(lang: lang) { home.judgeAnother() }
                    .disabled(home.isBusy)
            }
        }
        .frame(minHeight: 44)
        .padding(.top, 8)
        .padding(.horizontal, 4)
        .accessibilityElement(children: .contain)
    }

    /// Both sides: yours in green, theirs in red.
    /// Written together they go to the judges as one text; "Or send them a
    /// link" makes a two-sided case instead.
    private func form(_ lang: AppLang, home: HomeModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            exampleButton(lang, home: home)
            if home.isBlank {
                lead(lang)
            }
            sideCard(lang, home: home, mine: true)
            sideCard(lang, home: home, mine: false)
            counter(lang, home: home)
            if let error = home.error {
                errorBanner(error, lang: lang)
                    .id(Self.errorID)
            }
            submitSection(lang, home: home)
                .id(HomeModel.submitAnchor)
        }
    }

    private func exampleButton(_ lang: AppLang, home: HomeModel) -> some View {
        Button {
            focused = nil
            home.fillExample(lang: lang)
        } label: {
            Label(L10n.appHomeExample(lang), systemImage: "shuffle")
        }
        .buttonStyle(ChipButtonStyle())
        .disabled(home.isBusy)
    }

    private func lead(_ lang: AppLang) -> some View {
        Text(app.casesOn ? L10n.appHomeLead(lang) : L10n.appHomeLeadSolo(lang))
            .brandText(TypeStyle(face: .inter, weight: 400, size: 14, lineHeight: 1.45, textStyle: .subheadline))
            .foregroundStyle(Brand.ink2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 4)
    }

    private func sideCard(_ lang: AppLang, home: HomeModel, mine: Bool) -> some View {
        @Bindable var home = home
        let field: Field = mine ? .mine : .theirs
        let ink = mine ? sides.mine.ink : sides.theirs.ink
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                PartyAvatar(party: mine ? .a : .b)
                CaseNameField(
                    name: mine ? $home.caseName : $home.otherName,
                    fallback: mine ? Names.firstName(app.account.user?.name) ?? "" : "",
                    placeholder: mine ? L10n.appHomeYourName(lang) : L10n.appHomeTheirName(lang),
                    disabled: home.isBusy
                )
                Text(mine ? L10n.appHomeYourSide(lang) : L10n.appHomeTheirSide(lang))
                    .brandText(TypeStyle(face: .inter, weight: 600, size: 11, lineHeight: 1.2, tracking: 0.08, textStyle: .caption2, maxScale: 1.6, uppercase: true))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .accessibilityHidden(true)
            }
            editor(
                mine ? $home.argument : $home.otherSide,
                field: field,
                placeholder: mine ? L10n.appHomeYourPlaceholder(lang) : L10n.appHomeTheirPlaceholder(lang),
                label: mine ? L10n.appHomeYourSideLabel(lang) : L10n.appHomeTheirSideLabel(lang),
                minHeight: mine ? 96 : 56
            )
            .disabled(home.isBusy)
            if mine, app.evidenceOn {
                EvidencePickerView(evidence: home.evidence, lang: lang, disabled: home.isBusy)
                    .id(HomeModel.evidenceAnchor)
                    .padding(.top, 4)
            }
            if !mine, app.casesOn, home.otherSide.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                sendLink(lang, home: home)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .paperSurface(radius: Radius.block, border: focused == field ? ink.opacity(0.6) : Brand.line)
        .softShadow()
        .accessibilityElement(children: .contain)
    }

    private func editor(_ text: Binding<String>, field: Field, placeholder: String, label: String, minHeight: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: text)
                .focused($focused, equals: field)
                .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5))
                .foregroundStyle(Brand.ink)
                .scrollContentBackground(.hidden)
                .frame(minHeight: minHeight)
                // TextEditor insets its text; this lines it up with the name above.
                .padding(.horizontal, -5)
                .padding(.vertical, -8)
                .accessibilityLabel(label)
            if text.wrappedValue.isEmpty {
                Text(placeholder)
                    .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5))
                    .foregroundStyle(Brand.placeholder)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }

    /// Only before their side is written: the link means they write it.
    /// The case costs a verdict like any other.
    private func sendLink(_ lang: AppLang, home: HomeModel) -> some View {
        let ready = home.canSubmit(app)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                focused = nil
                home.sendLink(app: app)
            } label: {
                Label(L10n.appHomeSendLink(lang), systemImage: "link")
                    .brandText(TypeStyle(face: .inter, weight: 600, size: 13, lineHeight: 1.2, textStyle: .footnote, maxScale: 1.8))
                    .foregroundStyle(Brand.sageInk)
                    .frame(minHeight: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!ready)
            .opacity(ready ? 1 : 0.5)
        }
    }

    /// The joined text's length against the limit, as the single field had it.
    private func counter(_ lang: AppLang, home: HomeModel) -> some View {
        let length = home.length(app)
        return Text(L10n.appInputCounter(lang, count: String(length), max: String(HomeModel.maxLength)))
            .brandText(.footnote)
            .monospacedDigit()
            .foregroundStyle(length > HomeModel.warnLength ? Brand.terraInk : Brand.muted)
            .lineLimit(1)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, 4)
            .padding(.vertical, -4)
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
            let waiting = home.isCheckingQuestions || home.isCreatingCase
            let title = L10n.getVerdict(lang)
            Button {
                // Still enabled while waiting so the spinner isn't dimmed; a
                // tap then must not turn a case being created into a verdict.
                guard home.canSubmit(app) else { return }
                home.mode = .now
                submit()
            } label: {
                if waiting {
                    // The questions or the new case run before anything
                    // else goes up.
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
            .disabled(!home.canSubmit(app) && !waiting)
            .padding(.top, 4)
            if home.isCheckingQuestions || home.isCreatingCase {
                Text(home.isCreatingCase ? L10n.caseCreating(lang) : L10n.tierChecking(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
                    .accessibilityAddTraits(.updatesFrequently)
            } else if app.account.isSignedIn, let entitlement = app.account.entitlement {
                Text(Balance(entitlement).line(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.muted)
            }
        }
    }

    /// Also "Try again", which repeats whatever was sent last (a verdict or a case).
    private func submit() {
        focused = nil
        app.home.submit(app: app)
    }
}

/// "Get the verdict" (thread.module.css .submit).
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
