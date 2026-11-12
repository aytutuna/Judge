import SwiftUI

enum SettingsRoute: Hashable {
    case pricing, language, account
}

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var colorScheme
    @State private var webLink: WebLink?
    @State private var confirmSignOut = false

    var body: some View {
        let lang = app.lang
        @Bindable var model = app
        NavigationStack(path: $model.settingsPath) {
            List {
                AccountSection()

                Section {
                    NavigationLink(value: SettingsRoute.language) {
                        Text(languageChoice(lang))
                            .brandText(.body)
                            .foregroundStyle(Brand.ink)
                    }
                } header: {
                    Kicker(text: L10n.appSettingsLanguage(lang))
                }
                .listRowBackground(Brand.paper)

                Section {
                    Toggle(isOn: Binding(get: { colorScheme == .dark }, set: {
                        app.setAppearance($0 ? .dark : .light)
                        app.analytics.track("settings_changed", ["key": "appearance"])
                    })) {
                        Text(L10n.settingsDarkMode(lang))
                            .brandText(.body)
                            .foregroundStyle(Brand.ink)
                    }
                    .tint(Brand.terraInk)
                } header: {
                    Kicker(text: L10n.appSettingsAppearance(lang))
                }
                .listRowBackground(Brand.paper)

                Section {
                    Toggle(isOn: Binding(get: { app.usageStats }, set: { app.setUsageStats($0) })) {
                        Text(L10n.appSettingsUsageStats(lang))
                            .brandText(.body)
                            .foregroundStyle(Brand.ink)
                    }
                    .tint(Brand.terraInk)
                    linkRow(L10n.appSettingsAbout(lang), path: "about")
                    linkRow(L10n.howTitle(lang), path: "#how")
                    linkRow(L10n.footerPrivacy(lang), path: "privacy")
                    linkRow(L10n.appLegalTerms(lang), path: "terms")
                } header: {
                    Kicker(text: L10n.footerPrivacy(lang))
                } footer: {
                    Text(L10n.appSettingsUsageStatsHint(lang))
                        .brandText(.footnote)
                        .foregroundStyle(Brand.muted)
                }
                .listRowBackground(Brand.paper)

                if app.account.isSignedIn {
                    Section {
                        Button {
                            confirmSignOut = true
                        } label: {
                            HStack {
                                Text(L10n.accountSignOut(lang))
                                    .brandText(.body)
                                    .foregroundStyle(Brand.ink)
                                Spacer()
                                if app.account.busy == .signOut {
                                    ProgressView().tint(Brand.muted)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(app.account.busy != nil)
                    }
                    .listRowBackground(Brand.paper)
                }

                Section {
                    EmptyView()
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(L10n.footerNote(lang))
                        Text(L10n.appSettingsVersion(lang, version: "\(app.config.version) (\(app.config.build))"))
                    }
                    .brandText(.footnote)
                    .foregroundStyle(Brand.muted)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Brand.ivory.ignoresSafeArea())
            .navigationTitle(L10n.appTabSettings(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                RootBarLeading()
                RootBarTrailing()
            }
            .sheet(item: $webLink) { link in
                SafariView(url: link.url).ignoresSafeArea()
            }
            .alert(L10n.appAccountSignOutConfirm(lang), isPresented: $confirmSignOut) {
                Button(L10n.accountSignOut(lang), role: .destructive) {
                    Task { await app.account.signOut() }
                }
                Button(L10n.appCancel(lang), role: .cancel) {}
            }
            .navigationDestination(for: SettingsRoute.self) { route in
                switch route {
                case .pricing: PricingView()
                case .language: LanguageList()
                case .account: AccountView()
                }
            }
            .onTabAppear {
                Task { await app.account.refresh() }
                app.analytics.track("screen_view", ["screen": "settings"])
            }
            .onDisappear { app.purchases.clearRestoreResult() }
            .onChange(of: app.tab) { _, tab in
                if tab != .settings { app.purchases.clearRestoreResult() }
            }
        }
    }

    private func languageChoice(_ lang: AppLang) -> String {
        switch app.langPreference {
        case .system: return L10n.appSettingsLanguageDevice(lang)
        case .fixed(let fixed): return fixed.nativeName
        }
    }

    private func linkRow(_ title: String, path: String) -> some View {
        Button {
            webLink = WebLink(url: siteURL(path))
        } label: {
            HStack {
                Text(title)
                    .brandText(.body)
                    .foregroundStyle(Brand.ink)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// `#how` is an anchor on the about page; everything else is a path.
    private func siteURL(_ path: String) -> URL {
        guard path.hasPrefix("#") else { return app.config.siteURL(path) }
        var components = URLComponents(url: app.config.shareBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/about"
        components?.fragment = String(path.dropFirst())
        return components?.url ?? app.config.shareBaseURL
    }
}

/// Every language the app speaks, each in its own words, below "Same as the
/// phone". A row also names the language in the current one when that reads
/// differently.
private struct LanguageList: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        let lang = app.lang
        List {
            Section {
                row(.system, title: L10n.appSettingsLanguageDevice(lang), subtitle: nil)
            }
            .listRowBackground(Brand.paper)
            Section {
                ForEach(AppLang.enabled, id: \.self) { option in
                    let name = option.name(in: lang)
                    row(.fixed(option), title: option.nativeName, subtitle: name == option.nativeName ? nil : name)
                        .environment(\.locale, option.locale)
                }
            }
            .listRowBackground(Brand.paper)
        }
        .scrollContentBackground(.hidden)
        .background(Brand.ivory.ignoresSafeArea())
        .navigationTitle(L10n.appSettingsLanguage(lang))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    private func row(_ preference: LangPreference, title: String, subtitle: String?) -> some View {
        let selected = app.langPreference == preference
        return Button {
            app.setLangPreference(preference)
            app.analytics.track("settings_changed", ["key": "language"])
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .brandText(.body)
                        .foregroundStyle(Brand.ink)
                    if let subtitle {
                        Text(subtitle)
                            .brandText(.footnote)
                            .foregroundStyle(Brand.muted)
                    }
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Brand.terraInk)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
