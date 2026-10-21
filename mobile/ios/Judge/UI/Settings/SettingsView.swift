import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var webLink: WebLink?
    @State private var confirmSignOut = false
    @State private var confirmDelete = false

    var body: some View {
        let lang = app.lang
        NavigationStack {
            List {
                AccountSection(confirmSignOut: $confirmSignOut, confirmDelete: $confirmDelete)

                Section {
                    NavigationLink {
                        PricingView()
                    } label: {
                        Label {
                            Text(L10n.navPricing(lang))
                                .brandText(.body)
                                .foregroundStyle(Brand.ink)
                        } icon: {
                            Image(systemName: "sparkle")
                                .foregroundStyle(Brand.terraInk)
                        }
                    }
                }
                .listRowBackground(Brand.paper)

                Section {
                    languageRow(.system, title: L10n.appSettingsLanguageDevice(lang))
                    languageRow(.en, title: L10n.appLangEn(lang))
                    languageRow(.tr, title: L10n.appLangTr(lang))
                } header: {
                    Kicker(text: L10n.appSettingsLanguage(lang))
                }
                .listRowBackground(Brand.paper)

                Section {
                    linkRow(L10n.appSettingsAbout(lang), path: "about")
                    linkRow(L10n.navHow(lang), path: "#how")
                    linkRow(L10n.footerPrivacy(lang), path: "privacy")
                }
                .listRowBackground(Brand.paper)

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
            .toolbarBackground(Brand.ivory, for: .navigationBar)
            .sheet(item: $webLink) { link in
                SafariView(url: link.url).ignoresSafeArea()
            }
            .alert(L10n.appAccountSignOutConfirm(lang), isPresented: $confirmSignOut) {
                Button(L10n.accountSignOut(lang), role: .destructive) {
                    Task { await app.account.signOut() }
                }
                Button(L10n.appCancel(lang), role: .cancel) {}
            }
            .alert(L10n.appAccountDeleteTitle(lang), isPresented: $confirmDelete) {
                Button(L10n.appAccountDeleteConfirm(lang), role: .destructive) {
                    Task { await app.account.deleteAccount() }
                }
                Button(L10n.accountDeleteCancel(lang), role: .cancel) {}
            } message: {
                Text(L10n.appAccountDeleteBody(lang))
            }
            .task { await app.account.refresh() }
            .onDisappear { app.purchases.clearRestoreResult() }
        }
    }

    private func languageRow(_ preference: LangPreference, title: String) -> some View {
        Button {
            app.setLangPreference(preference)
        } label: {
            HStack {
                Text(title)
                    .brandText(.body)
                    .foregroundStyle(Brand.ink)
                Spacer()
                if app.langPreference == preference {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Brand.terraInk)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(app.langPreference == preference ? .isSelected : [])
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

    /// `#how` is an anchor on the home page; everything else is a path.
    private func siteURL(_ path: String) -> URL {
        guard path.hasPrefix("#") else { return app.config.siteURL(path) }
        var components = URLComponents(url: app.config.shareBaseURL, resolvingAgainstBaseURL: false)
        components?.path = "/"
        components?.fragment = String(path.dropFirst())
        return components?.url ?? app.config.shareBaseURL
    }
}
