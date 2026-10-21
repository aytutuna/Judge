import SwiftUI
import UIKit

/// The owner's private invite link (components/case/InviteLink.tsx): the
/// link, Copy, the share sheet, the expiry date and "Make a new link". The
/// link opens the website's answer page; the app never handles it itself.
struct InviteLinkView: View {
    let url: String
    let expiresAt: String
    let lang: AppLang
    let resetting: Bool
    let resetDone: Bool
    let onReset: () -> Void
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L10n.caseInviteLabel(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
            Text(verbatim: url)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Brand.ink)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .paperSurface(radius: 12, fill: Brand.ivory, border: Brand.line2)
            HStack(spacing: 8) {
                Button {
                    UIPasteboard.general.string = url
                    copied = true
                } label: {
                    Label(copied ? L10n.caseInviteCopied(lang) : L10n.caseInviteCopy(lang), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(GhostButtonStyle())
                .task(id: copied) {
                    guard copied else { return }
                    try? await Task.sleep(for: .seconds(2))
                    if !Task.isCancelled { copied = false }
                }
                if let link = URL(string: url) {
                    ShareLink(item: link, message: Text(L10n.caseInviteShareText(lang))) {
                        Label(L10n.caseInviteShare(lang), systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(GhostButtonStyle())
                }
            }
            Text(ErrorText.formatDate(expiresAt, lang: lang).map { L10n.caseInviteExpires(lang, date: $0) } ?? L10n.caseInviteExpiresSoon(lang))
                .brandText(.slotText)
                .foregroundStyle(Brand.muted)
            Button(L10n.caseInviteReset(lang), action: onReset)
                .buttonStyle(LinkButtonStyle())
                .disabled(resetting)
            if resetDone {
                Text(L10n.caseInviteResetDone(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.sageInk)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
    }
}

/// The appeal area (components/case/AppealForm.tsx AppealSection): the
/// "add context" form, its upsell, or why not.
struct AppealSection: View {
    @Environment(AppModel.self) private var app
    @Bindable var model: CaseModel
    let view: CaseView
    let lang: AppLang
    let onPricing: () -> Void

    var body: some View {
        switch CaseLogic.appealArea(view) {
        case .none:
            EmptyView()
        case .judging:
            HStack(spacing: 10) {
                ProgressView().tint(Brand.muted)
                Text(L10n.appealJudging(lang))
                    .brandText(.body)
                    .foregroundStyle(Brand.ink2)
            }
            .accessibilityElement(children: .combine)
        case .busy:
            note(L10n.appealBusy(lang))
        case .used:
            note(L10n.appealUsed(lang))
        case .upsell(let signIn):
            card {
                title
                note(L10n.appealUpsell(lang))
                if signIn {
                    Button(L10n.appealSignIn(lang)) { app.account.presentSignIn() }
                        .buttonStyle(PrimaryButtonStyle())
                } else {
                    Button(L10n.tierGetPremium(lang), action: onPricing)
                        .buttonStyle(GhostButtonStyle())
                }
            }
        case .blocked(let reason):
            card {
                title
                note(blockedText(reason))
                Button(L10n.tierGetPremium(lang), action: onPricing)
                    .buttonStyle(GhostButtonStyle())
            }
        case .form(let failed):
            form(failed: failed)
        }
    }

    private var title: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkle")
                .foregroundStyle(Brand.terraInk)
                .accessibilityHidden(true)
            Text(L10n.appealTitle(lang))
                .brandText(TypeStyle(face: .interTight, weight: 700, size: 20, lineHeight: 1.2, tracking: -0.01, textStyle: .title3, maxScale: 1.5))
                .foregroundStyle(Brand.ink)
        }
        .accessibilityAddTraits(.isHeader)
    }

    /// The owner sees why it is blocked. Fair use names the reset date when
    /// the account has one.
    private func blockedText(_ reason: String) -> String {
        switch reason {
        case "no_credits": return L10n.errorNoCredits(lang)
        case "fair_use":
            return ErrorText.formatDate(app.account.entitlement?.resetsAt, lang: lang).map { L10n.errorFairUse(lang, date: $0) }
                ?? L10n.errorFairUseSoon(lang)
        default: return L10n.errorPremiumRequired(lang)
        }
    }

    private func form(failed: String?) -> some View {
        card {
            title
            note(L10n.appealLead(lang))
            if let failed {
                Text(failed == "refused" ? L10n.appealRefused(lang) : L10n.appealFailed(lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .paperSurface(radius: 14, fill: Brand.strata.opacity(0.6), border: Brand.stone)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(L10n.appealLabel(lang))
                        .brandText(.slotTitle)
                        .foregroundStyle(Brand.ink)
                    Spacer()
                    Text(verbatim: "\(model.appealText.utf16.count) / \(CaseLogic.maxAppeal)")
                        .brandText(.footnote)
                        .monospacedDigit()
                        .foregroundStyle(Brand.muted)
                        .accessibilityHidden(true)
                }
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $model.appealText)
                        .brandText(.body)
                        .foregroundStyle(Brand.ink)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 120)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .disabled(model.appealSending)
                        .accessibilityLabel(L10n.appealLabel(lang))
                    if model.appealText.isEmpty {
                        Text(L10n.appealPlaceholder(lang))
                            .brandText(.body)
                            .foregroundStyle(Brand.placeholder)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 14)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .paperSurface(radius: Radius.field, fill: Brand.paper, border: Brand.line2)
            }
            .onChange(of: model.appealText) { _, value in
                let capped = HomeModel.capUTF16(value, max: CaseLogic.maxAppeal)
                if capped != value { model.appealText = capped }
            }
            if app.account.features.evidence {
                EvidencePickerView(evidence: model.appealEvidence, lang: lang, disabled: model.appealSending)
            }
            if let error = model.appealError {
                ErrorBanner(message: ErrorText.message(error, lang: lang))
            }
            Button {
                Task { await model.submitAppeal() }
            } label: {
                Text(model.appealSending ? L10n.appealSending(lang) : L10n.appealSubmit(lang))
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.appealCanSubmit)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .brandText(.body)
            .foregroundStyle(Brand.ink2)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .paperSurface(radius: Radius.card)
    }
}

/// The owner's name on the case's share pages and the names switch
/// (CaseNames in components/case/CaseOwnTools.tsx). PATCH .../display.
struct CaseNamesCard: View {
    @Bindable var model: CaseModel
    let view: CaseView
    let lang: AppLang
    @State private var name: String

    @MainActor
    init(model: CaseModel, view: CaseView, lang: AppLang) {
        self.model = model
        self.view = view
        self.lang = lang
        _name = State(initialValue: model.displayNameDraft ?? view.display.a ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L10n.namesTitle(lang))
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
                .accessibilityAddTraits(.isHeader)
            Button {
                Task { await model.setNamesVisible(!view.display.namesVisible) }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: view.display.namesVisible ? "checkmark.square.fill" : "square")
                        .foregroundStyle(view.display.namesVisible ? Brand.terraInk : Brand.muted)
                        .accessibilityHidden(true)
                    Text(L10n.namesShow(lang))
                        .brandText(.body)
                        .foregroundStyle(Brand.ink)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.displayBusy)
            .accessibilityAddTraits(view.display.namesVisible ? .isSelected : [])
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.caseDisplayName(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.ink2)
                HStack(spacing: 8) {
                    TextField("", text: $name)
                        .textContentType(.givenName)
                        .brandText(.body)
                        .foregroundStyle(Brand.ink)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .paperSurface(radius: 12, fill: Brand.paper, border: Brand.line2)
                        .disabled(model.displayBusy)
                        .accessibilityLabel(L10n.caseDisplayName(lang))
                        .onChange(of: name) { _, value in
                            let capped = String(value.prefix(40))
                            if capped != value { name = capped }
                            model.displayNameDraft = capped
                        }
                    Button(L10n.caseDisplaySave(lang)) {
                        model.displayNameDraft = name
                        Task { await model.saveDisplayName() }
                    }
                    .buttonStyle(GhostButtonStyle())
                    .disabled(model.displayBusy)
                }
            }
            if let failure = model.displayFailure {
                Text(failure.message(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.danger)
            } else if model.displaySaved {
                Text(L10n.namesSaved(lang))
                    .brandText(.slotText)
                    .foregroundStyle(Brand.sageInk)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .paperSurface(radius: Radius.card)
    }
}

/// The accounts exactly as the judges read them (components/case/AccountsRead.tsx):
/// anonymized text and image transcripts, names deliberately not restored.
/// Before a verdict only the owner's side comes; after a two-sided verdict
/// both, and any context added by appeal.
struct AccountsReadView: View {
    let view: CaseView
    let lang: AppLang

    var body: some View {
        let bothRead = view.sides.count > 1
        let sides = (bothRead ? view.sides : view.sides.filter { $0.party == view.yourParty })
            .sorted { $0.party.rawValue < $1.party.rawValue }
        let appeals = (bothRead || view.mode == .oneSided ? view.appeals : [])
            .filter { $0.status != .failed && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if !sides.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Kicker(text: bothRead ? L10n.caseAccounts(lang) : L10n.caseYourSide(lang))
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(sides.enumerated()), id: \.offset) { _, side in
                    account(
                        title: side.party == view.yourParty
                            ? L10n.caseAccountYou(lang, label: label(side.party))
                            : (side.party == .a ? L10n.caseAccountA(lang) : L10n.caseAccountB(lang)),
                        party: side.party,
                        text: side.removed ? nil : side.text,
                        evidence: side.removed ? [] : side.evidence
                    )
                }
                ForEach(Array(appeals.enumerated()), id: \.offset) { _, appeal in
                    account(
                        title: appeal.party == view.yourParty
                            ? L10n.caseContextYou(lang, label: label(appeal.party))
                            : (appeal.party == .a ? L10n.caseContextA(lang) : L10n.caseContextB(lang)),
                        party: appeal.party,
                        text: appeal.text,
                        evidence: appeal.evidence
                    )
                }
            }
        }
    }

    private func label(_ party: Party) -> String {
        party == .a ? L10n.partyA(lang) : L10n.partyB(lang)
    }

    /// "Party A" in Turkish text reads "Taraf A" (localizeLabels on the web).
    private func localized(_ text: String) -> String {
        CaseLogic.localizeLabels(text, lang: view.lang ?? ContentLang.of(text))
    }

    private func account(title: String, party: Party, text: String?, evidence: [CaseEvidence]) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                if let text {
                    Text(localized(text))
                        .brandText(TypeStyle(face: .inter, weight: 400, size: 15, lineHeight: 1.5))
                        .foregroundStyle(Brand.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(Array(evidence.enumerated()), id: \.offset) { index, item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(L10n.caseEvidenceItem(lang, n: String(index + 1)))
                                .brandText(.slotTitle)
                                .foregroundStyle(Brand.ink2)
                            Text(localized(item.transcript))
                                .font(.system(.footnote, design: .monospaced))
                                .foregroundStyle(Brand.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } else {
                    Text(L10n.caseSideRemoved(lang))
                        .brandText(.slotText)
                        .foregroundStyle(Brand.muted)
                }
            }
            .padding(.top, 8)
        } label: {
            Text(title)
                .brandText(.slotTitle)
                .foregroundStyle(Brand.ink)
        }
        .tint(Brand.ink2)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.paper))
        .overlay(alignment: .leading) {
            Rectangle().fill(party == .a ? Brand.terra : Brand.sageStrong).frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
    }
}
