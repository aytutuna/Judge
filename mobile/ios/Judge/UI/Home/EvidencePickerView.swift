import PhotosUI
import SwiftUI

/// The screenshot picker (components/case/EvidencePicker.tsx): picked
/// images upload at once and each shows how it went; a read image can show
/// what was read (only to the uploader). Used on Home (up to three) and in
/// the appeal form (one).
struct EvidencePickerView: View {
    @Environment(AppModel.self) private var app
    let evidence: EvidenceModel
    let lang: AppLang
    let disabled: Bool
    @State private var selection: [PhotosPickerItem] = []

    var body: some View {
        let single = evidence.max == 1
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(L10n.evidenceLabel(lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                Spacer()
                Text(verbatim: "\(evidence.items.count) / \(evidence.max)")
                    .brandText(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            ForEach(evidence.items) { item in
                EvidenceRow(item: item, lang: lang, disabled: disabled) { evidence.remove(item.id) }
            }
            PhotosPicker(
                selection: $selection,
                maxSelectionCount: Swift.max(1, evidence.room),
                selectionBehavior: .ordered,
                matching: .images
            ) {
                Label(single ? L10n.evidenceAddOne(lang) : L10n.evidenceAdd(lang), systemImage: "plus")
            }
            .buttonStyle(GhostButtonStyle())
            .disabled(disabled || evidence.full)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "lock")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(single ? L10n.evidenceHintOne(lang) : L10n.evidenceHint(lang, n: String(evidence.max)))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .brandText(.footnote)
            .foregroundStyle(Brand.muted)
            if evidence.overLimit {
                Text(L10n.evidenceLimit(lang))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.ink2)
            }
            if let failure = evidence.failure {
                Text(ErrorText.message(failure, lang: lang))
                    .brandText(.footnote)
                    .foregroundStyle(Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onChange(of: selection) { _, picked in
            guard !picked.isEmpty else { return }
            selection = []
            add(picked)
        }
    }

    private func add(_ picked: [PhotosPickerItem]) {
        let ids = evidence.reserve(picked.count)
        guard !ids.isEmpty else { return }
        let fitting = Array(picked.prefix(ids.count))
        let evidence = evidence
        let api = app.api
        let account = app.account
        Task {
            var files: [Data?] = []
            for item in fitting {
                files.append(try? await item.loadTransferable(type: Data.self))
            }
            await evidence.process(ids, files: files, api: api, account: account)
        }
    }
}

private struct EvidenceRow: View {
    let item: EvidenceItem
    let lang: AppLang
    let disabled: Bool
    let onRemove: () -> Void

    var body: some View {
        let name = L10n.evidenceThumb(lang, n: String(item.n))
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 12) {
                thumbnail
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                    .accessibilityLabel(name)
                VStack(alignment: .leading, spacing: 3) {
                    Text(name)
                        .brandText(.slotTitle)
                        .foregroundStyle(Brand.ink)
                    HStack(spacing: 6) {
                        if item.status == .reading {
                            ProgressView().controlSize(.mini).tint(Brand.muted)
                        } else {
                            Image(systemName: item.status == .ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                                .font(.system(size: 12))
                                .accessibilityHidden(true)
                        }
                        Text(item.status.text(lang))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .brandText(.footnote)
                    .foregroundStyle(tone)
                }
                Spacer(minLength: 0)
                Button(action: onRemove) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Brand.ink2)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Brand.ivory2))
                }
                .buttonStyle(.plain)
                .disabled(disabled)
                .accessibilityLabel(L10n.evidenceRemove(lang, n: String(item.n)))
            }
            if item.status == .ok, let preview = item.preview, !preview.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L10n.evidencePreviewNote(lang))
                            .brandText(.footnote)
                            .foregroundStyle(Brand.muted)
                        Text(preview)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(Brand.ink2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    .padding(.top, 6)
                } label: {
                    Text(L10n.evidencePreview(lang))
                        .brandText(.slotTitle)
                        .foregroundStyle(Brand.ink2)
                }
                .tint(Brand.ink2)
            }
        }
        .padding(10)
        .paperSurface(radius: 14)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let thumb = item.thumb {
            Image(uiImage: thumb)
                .resizable()
                .scaledToFill()
        } else {
            ZStack {
                Brand.ivory2
                Image(systemName: "photo")
                    .foregroundStyle(Brand.muted)
            }
        }
    }

    private var tone: Color {
        switch item.status {
        case .ok: return Brand.sageInk
        case .reading: return Brand.muted
        default: return Brand.danger
        }
    }
}
