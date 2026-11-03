import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// An image ready to upload as evidence.
struct PreparedImage: Sendable, Equatable {
    let data: Data
    let mimeType: String
    /// Pixel size as uploaded (after orientation).
    let width: Int
    let height: Int

    var fileExtension: String {
        switch mimeType {
        case "image/png": return "png"
        case "image/gif": return "gif"
        case "image/webp": return "webp"
        default: return "jpg"
        }
    }
}

/// One picked image as it arrives from the photo library.
enum EvidenceSource: Sendable {
    /// A copy of the file on disk (preferred: never held in memory whole).
    case file(URL)
    case data(Data)
    /// Could not be loaded.
    case missing
}

/// Loads one picked image when its turn comes.
typealias EvidenceLoader = @Sendable () async -> EvidenceSource

enum PreparedOutcome: Sendable, Equatable {
    case ready(PreparedImage)
    case tooLarge
    case unsupported
}

/// Port of lib/image-downscale.ts. A screenshot is downscaled to 1600 px on
/// its longest side and re-encoded as JPEG on white, which also drops EXIF
/// data such as the GPS position. Small PNG and GIF images go as they are:
/// text stays crisp and they carry no camera metadata. The server still
/// checks every byte; this only keeps uploads small on mobile networks.
/// Pure ImageIO and Core Graphics, so it runs off the main thread.
enum ImagePreparation {
    static let longEdge = 1600
    /// MAX_IMAGE_BYTES (lib/case-types.ts).
    static let maxBytes = 5 * 1024 * 1024
    static let jpegQuality = 0.85

    /// The size that fits inside `max` on its longest side, keeping the ratio.
    static func fitWithin(width: Int, height: Int, max: Int = longEdge) -> (width: Int, height: Int, scaled: Bool) {
        let long = Swift.max(width, height)
        guard long > max else { return (width, height, false) }
        let ratio = Double(max) / Double(long)
        return (
            Swift.max(1, Int((Double(width) * ratio).rounded())),
            Swift.max(1, Int((Double(height) * ratio).rounded())),
            true
        )
    }

    /// Whether the original file can be uploaded untouched.
    static func keepOriginal(type: String, width: Int, height: Int, bytes: Int) -> Bool {
        (type == "image/png" || type == "image/gif")
            && !fitWithin(width: width, height: height).scaled
            && bytes <= maxBytes
    }

    /// Largest picked file read at all; anything bigger is "too big" without
    /// being decoded (a photo this large would only be downscaled anyway).
    static let maxSourceBytes = 40 * 1024 * 1024

    /// One picked image, whatever form it came in. A file is removed once read.
    static func prepare(_ source: EvidenceSource) -> PreparedOutcome {
        switch source {
        case .missing:
            return .unsupported
        case .data(let data):
            guard data.count <= maxSourceBytes else { return .tooLarge }
            return prepare(data).map(PreparedOutcome.ready) ?? .unsupported
        case .file(let url):
            defer { try? FileManager.default.removeItem(at: url) }
            return prepare(fileAt: url)
        }
    }

    /// A picked file read straight from disk: the whole file is only loaded
    /// when it is uploaded as it is (small PNG or GIF).
    static func prepare(fileAt url: URL) -> PreparedOutcome {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
        guard size <= maxSourceBytes else { return .tooLarge }
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithURL(url as CFURL, sourceOptions as CFDictionary) else { return .unsupported }
        let prepared = prepare(source: source, bytes: size) { try? Data(contentsOf: url) }
        return prepared.map(PreparedOutcome.ready) ?? .unsupported
    }

    /// The upload for one picked file, or nil when it cannot be decoded at
    /// all (it is then reported as unsupported without an upload). Formats
    /// the server does not take (HEIC from the photo library) come out as JPEG.
    static func prepare(_ data: Data) -> PreparedImage? {
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary) else { return nil }
        return prepare(source: source, bytes: data.count) { data }
    }

    private static func prepare(source: CGImageSource, bytes: Int, original: () -> Data?) -> PreparedImage? {
        guard CGImageSourceGetCount(source) > 0,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let pixelWidth = (properties[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
              let pixelHeight = (properties[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
              pixelWidth > 0, pixelHeight > 0
        else { return nil }
        // EXIF orientations 5-8 turn the picture a quarter: width and height swap.
        let orientation = (properties[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
        let rotated = (5...8).contains(orientation)
        let width = rotated ? pixelHeight : pixelWidth
        let height = rotated ? pixelWidth : pixelHeight
        let type = mimeType(of: source)
        if keepOriginal(type: type, width: width, height: height, bytes: bytes), let data = original() {
            return PreparedImage(data: data, mimeType: type, width: width, height: height)
        }
        let size = fitWithin(width: width, height: height)
        let thumbnailOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: Swift.max(size.width, size.height),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions as CFDictionary),
              let jpeg = jpegOnWhite(image, width: size.width, height: size.height)
        else { return nil }
        return PreparedImage(data: jpeg, mimeType: "image/jpeg", width: size.width, height: size.height)
    }

    private static func mimeType(of source: CGImageSource) -> String {
        guard let identifier = CGImageSourceGetType(source) as String?,
              let mime = UTType(identifier)?.preferredMIMEType
        else { return "application/octet-stream" }
        return mime
    }

    /// Draws `image` into an opaque white canvas of the given size and
    /// encodes it as JPEG without any metadata. JPEG has no alpha:
    /// transparent screenshots get a white page, not black.
    static func jpegOnWhite(_ image: CGImage, width: Int, height: Int) -> Data? {
        let space = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: space,
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        ) else { return nil }
        let rect = CGRect(x: 0, y: 0, width: width, height: height)
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        context.fill(rect)
        context.interpolationQuality = .high
        context.draw(image, in: rect)
        guard let flat = context.makeImage() else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output as CFMutableData, UTType.jpeg.identifier as CFString, 1, nil) else {
            return nil
        }
        let options: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: jpegQuality]
        CGImageDestinationAddImage(destination, flat, options as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }
}
