import SwiftUI

/// The parent step of the age gate: a teen whose account waits for a
/// parent's yes asks for it here.
extension AgeGateView {
    /// Reads the request and /me again every half minute while the step
    /// shows, so a yes given elsewhere opens the app by itself.
    func watchParent(_ account: AccountModel) async {
        while !Task.isCancelled {
            await account.parent.load()
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled else { return }
            await account.refresh()
        }
    }

    @ViewBuilder
    func parentStep(_ lang: AppLang, account: AccountModel) -> some View {
        let parent = account.parent
        let view = parent.view
        let deleteDate = ErrorText.formatDate(view?.deleteAt, lang: lang)
        switch ParentModel.screen(state: account.info?.age?.parent, view: view, changing: parent.changing) {
        case .declined:
            header(L10n.ageParentDeclinedTitle(lang), lead: Text(deleteDate.map { L10n.ageParentDeclined(lang, date: $0) } ?? ""))
            problem(lang, parent: parent)
            signOutAndDelete(lang, account: account)
        case .revoked:
            header(
                L10n.ageParentRevokedTitle(lang),
                lead: Text(deleteDate.map { L10n.ageParentRevoked(lang, date: $0) } ?? "")
            )
            emailForm(lang, parent: parent, deleteDate: nil)
            signOutAndDelete(lang, account: account)
        case .loading:
            header(L10n.ageParentTitle(lang), lead: Text(L10n.ageParentLead(lang)))
            ProgressView().frame(maxWidth: .infinity)
            signOutAndDelete(lang, account: account)
        case .waiting:
            if let view { waiting(lang, parent: parent, view: view, deleteDate: deleteDate) }
            signOutAndDelete(lang, account: account)
        case .form:
            header(L10n.ageParentTitle(lang), lead: Text(L10n.ageParentLead(lang)))
            emailForm(lang, parent: parent, deleteDate: deleteDate)
            signOutAndDelete(lang, account: account)
        }
    }

    private func waiting(_ lang: AppLang, parent: ParentModel, view: ParentView, deleteDate: String?) -> some View {
        let waitUntil = view.resendAt.flatMap(ErrorText.parseISO).flatMap { $0 > Date() ? $0 : nil }
        return VStack(alignment: .leading, spacing: 16) {
            Text(L10n.ageParentWaitTitle(lang))
                .brandText(.display1)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.ageParentSentTo(lang, email: view.emailHint ?? ""))
                if view.expired { Text(L10n.ageParentExpired(lang)) }
                if let waitUntil {
                    Text(L10n.ageParentResendAt(lang, time: Self.shortTime(waitUntil, lang: lang)))
                }
                if let deleteDate { Text(L10n.ageParentDelete(lang, date: deleteDate)) }
            }
            .brandText(.lead)
            .foregroundStyle(Brand.ink2)
            .fixedSize(horizontal: false, vertical: true)
            problem(lang, parent: parent)
            Button {
                Task { await parent.resend() }
            } label: {
                if parent.posting {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(L10n.ageParentResend(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(parent.posting || !view.canResend())
            Button(L10n.ageParentChange(lang)) {
                parent.startChange()
            }
            .buttonStyle(GhostButtonStyle())
            .disabled(parent.posting || !view.canChange)
        }
    }

    private func emailForm(_ lang: AppLang, parent: ParentModel, deleteDate: String?) -> some View {
        let address = Binding(get: { parent.email }, set: { parent.email = $0 })
        let empty = parent.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 16) {
            Text(L10n.ageParentEmail(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            TextField("", text: address)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.send)
                .onSubmit { if !empty { Task { await parent.send() } } }
                .disabled(parent.posting)
                .brandText(.body)
                .foregroundStyle(Brand.ink)
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .paperSurface(radius: Radius.field, fill: Brand.paper, border: Brand.line2)
                .accessibilityLabel(L10n.ageParentEmail(lang))
            if let deleteDate {
                Text(L10n.ageParentDelete(lang, date: deleteDate))
                    .brandText(.lead)
                    .foregroundStyle(Brand.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            problem(lang, parent: parent)
            Button {
                Task { await parent.send() }
            } label: {
                if parent.posting {
                    ProgressView().tint(Brand.ivory)
                } else {
                    Text(L10n.ageParentSend(lang))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(parent.posting || empty)
            if parent.changing {
                Button(L10n.ageParentCancel(lang)) {
                    parent.cancelChange()
                }
                .buttonStyle(GhostButtonStyle())
                .disabled(parent.posting)
            }
        }
    }

    @ViewBuilder
    private func problem(_ lang: AppLang, parent: ParentModel) -> some View {
        if let error = parent.error {
            ErrorBanner(message: ErrorText.message(error, lang: lang))
        }
    }

    private static func shortTime(_ date: Date, lang: AppLang) -> String {
        let formatter = DateFormatter()
        formatter.locale = lang.locale
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
