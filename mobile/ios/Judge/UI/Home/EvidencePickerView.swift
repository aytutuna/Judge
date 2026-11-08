import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The context picker (components/case/EvidencePicker.tsx): picked images
/// upload at once and each shows how it went; a read image can show what was
/// read (only to the uploader). Home puts the add control inside its box
/// and the rows below it; the appeal form uses this whole picker (one image).
struct EvidencePickerView: View {
    let evidence: EvidenceModel
    let lang: AppLang
    let disabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(L10n.appContextLabel(lang))
                    .brandText(.slotTitle)
                    .foregroundStyle(Brand.ink)
                Spacer()
                Text(verbatim: "\(evidence.items.count) / \(evidence.max)")
                    .brandText(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            EvidenceRows(evidence: evidence, lang: lang, disabled: disabled)
            EvidenceAddButton(evidence: evidence, disabled: disabled) {
                Label(L10n.appHomeAddContext(lang), systemImage: "plus")
            }
            .buttonStyle(GhostButtonStyle())
            EvidenceNotes(evidence: evidence, lang: lang)
        }
    }
}

/// The photo picker behind an "add" control; the caller styles the label.
struct EvidenceAddButton<Content: View>: View {
    @Environment(AppModel.self) private var app
    let evidence: EvidenceModel
    let disabled: Bool
    @ViewBuilder let label: () -> Content
    @State private var selection: [PhotosPickerItem] = []
    @State private var picking = false

    var body: some View {
        Button {
            // Uploads need an account; the draft stays in the home model.
            if app.account.isSignedIn {
                picking = true
            } else {
                app.account.presentSignIn()
            }
        } label: {
            label()
        }
        .photosPicker(
            isPresented: $picking,
            selection: $selection,
            maxSelectionCount: Swift.max(1, evidence.room),
            selectionBehavior: .ordered,
            matching: .images
        )
        .disabled(disabled || evidence.full)
        .onChange(of: picking) { _, open in
            app.sheetOpen = open
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
        app.analytics.track("evidence_added")
        let fitting = Array(picked.prefix(ids.count))
        let evidence = evidence
        let api = app.api
        let account = app.account
        // Each item is loaded only when its turn comes, as a file copy.
        let loaders: [EvidenceLoader] = fitting.map { item in
            { await PickedImage.load(item) }
        }
        Task {
            await evidence.process(ids, loaders: loaders, api: api, account: account)
        }
    }
}

/// The picked images, one row each.
struct EvidenceRows: View {
    let evidence: EvidenceModel
    let lang: AppLang
    let disabled: Bool

    var body: some View {
        ForEach(evidence.items) { item in
            EvidenceRow(item: item, lang: lang, disabled: disabled) { evidence.remove(item.id) }
        }
    }
}

/// What went wrong with the last pick, if anything.
struct EvidenceNotes: View {
    let evidence: EvidenceModel
    let lang: AppLang

    var body: some View {
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
}

/// A picked photo copied to a temporary file, so the whole image never has
/// to sit in memory (ImagePreparation reads it from disk and removes it).
struct PickedImage: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            let copy = FileManager.default.temporaryDirectory
                .appending(path: "evidence-\(UUID().uuidString)")
                .appendingPathExtension(received.file.pathExtension)
            try FileManager.default.copyItem(at: received.file, to: copy)
            return PickedImage(url: copy)
        }
    }

    /// The file copy, or the data as a fallback.
    static func load(_ item: PhotosPickerItem) async -> EvidenceSource {
        if let picked = try? await item.loadTransferable(type: PickedImage.self) {
            return .file(picked.url)
        }
        if let data = try? await item.loadTransferable(type: Data.self) {
            return .data(data)
        }
        return .missing
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
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
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
