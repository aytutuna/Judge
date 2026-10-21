package com.okjudge.judge.core.evidence

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream
import java.io.IOException
import kotlin.math.max
import kotlin.math.roundToInt

/** An image ready to upload, plus a small thumbnail for the picker row. */
class PreparedImage(
    val bytes: ByteArray,
    val mimeType: String,
    val thumbnail: Bitmap? = null,
) {
    val extension: String
        get() = when (mimeType) {
            "image/png" -> "png"
            "image/gif" -> "gif"
            else -> "jpg"
        }
}

/** What preparing a picked image gave: an upload, or why there is none. */
sealed interface Prepared {
    data class Ready(val image: PreparedImage) : Prepared
    /** Could not be decoded at all (reported as "unsupported", like the web). */
    data object Unsupported : Prepared
    /** Too big to even read on the phone (reported as "too_large" without an upload). */
    data object TooLarge : Prepared
}

/** Something the user picked that can be turned into an upload. */
fun interface ImageSource {
    suspend fun prepare(): Prepared
}

/**
 * Port of lib/image-downscale.ts: a picked image is downscaled to
 * [IMAGE_LONG_EDGE] on its longest side and re-encoded as JPEG (quality
 * [JPEG_QUALITY], drawn on white because JPEG has no alpha), which also
 * drops EXIF data such as the GPS position. A PNG or GIF already within the
 * long edge and [MAX_IMAGE_BYTES] is sent as it is. The server still checks
 * every byte.
 */
object ImagePrep {
    const val IMAGE_LONG_EDGE = 1600
    const val MAX_IMAGE_BYTES = 5 * 1024 * 1024
    const val JPEG_QUALITY = 85

    /** Longest picked file read into memory; anything larger is reported as too large without decoding. */
    const val MAX_READ_BYTES = 40 * 1024 * 1024

    private const val THUMB_EDGE = 160

    data class Size(val width: Int, val height: Int, val scaled: Boolean)

    /** Size that fits inside [max] on its longest side, keeping the aspect ratio (fitWithin). */
    fun fitWithin(width: Int, height: Int, max: Int = IMAGE_LONG_EDGE): Size {
        val long = max(width, height)
        if (long <= max) return Size(width, height, scaled = false)
        val ratio = max.toDouble() / long
        return Size(max(1, (width * ratio).roundToInt()), max(1, (height * ratio).roundToInt()), scaled = true)
    }

    /** Whether the original file can be uploaded untouched (keepOriginal). */
    fun keepOriginal(type: String?, width: Int, height: Int, bytes: Int): Boolean =
        (type == "image/png" || type == "image/gif") && !fitWithin(width, height).scaled && bytes <= MAX_IMAGE_BYTES

    /** Reads, downscales and re-encodes [uri]. */
    fun prepare(resolver: ContentResolver, uri: Uri): Prepared {
        val type = resolver.getType(uri)
        val read = try {
            resolver.openInputStream(uri)?.use { input -> readCapped(input) } ?: return Prepared.Unsupported
        } catch (_: IOException) {
            return Prepared.Unsupported
        } catch (_: SecurityException) {
            return Prepared.Unsupported
        }
        val bytes = read ?: return Prepared.TooLarge
        return prepare(bytes, type)?.let { Prepared.Ready(it) } ?: Prepared.Unsupported
    }

    /** The whole stream, or null past [MAX_READ_BYTES]. */
    private fun readCapped(input: java.io.InputStream): ByteArray? {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(64 * 1024)
        var total = 0
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            if (total > MAX_READ_BYTES) return null
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /** The bytes to upload for an image file of [type] (may be null or wrong; decoding decides). */
    fun prepare(bytes: ByteArray, type: String?): PreparedImage? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val sniffed = bounds.outMimeType ?: type
        if (bounds.outWidth > 0 && bounds.outHeight > 0 && keepOriginal(sniffed, bounds.outWidth, bounds.outHeight, bytes.size)) {
            val thumb = decodeScaled(bytes, fitWithin(bounds.outWidth, bounds.outHeight, THUMB_EDGE))
            return PreparedImage(bytes, sniffed!!, thumb)
        }
        val decoded = decodeForUpload(bytes, bounds) ?: return null
        return try {
            val size = fitWithin(decoded.width, decoded.height)
            val page = Bitmap.createBitmap(size.width, size.height, Bitmap.Config.ARGB_8888)
            Canvas(page).apply {
                drawColor(Color.WHITE)
                val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
                drawBitmap(decoded, null, android.graphics.Rect(0, 0, size.width, size.height), paint)
            }
            val out = ByteArrayOutputStream()
            page.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            val thumbSize = fitWithin(page.width, page.height, THUMB_EDGE)
            val thumb = Bitmap.createScaledBitmap(page, thumbSize.width, thumbSize.height, true)
            if (thumb !== page) page.recycle()
            PreparedImage(out.toByteArray(), "image/jpeg", thumb)
        } finally {
            decoded.recycle()
        }
    }

    /**
     * Decodes at or a little above the upload size. ImageDecoder (API 28+)
     * also applies the EXIF orientation, so a rotated camera photo stays
     * upright once re-encoded without its EXIF block.
     */
    private fun decodeForUpload(bytes: ByteArray, bounds: BitmapFactory.Options): Bitmap? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return ImageDecoder.decodeBitmap(ImageDecoder.createSource(java.nio.ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    val fit = fitWithin(info.size.width, info.size.height)
                    if (fit.scaled) decoder.setTargetSize(fit.width, fit.height)
                }
            } catch (_: IOException) {
                // Fall back to BitmapFactory, which some builds decode more formats with.
            } catch (_: RuntimeException) {
            }
        }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        return decodeScaled(bytes, fitWithin(bounds.outWidth, bounds.outHeight), bounds.outWidth, bounds.outHeight)
    }

    private fun decodeScaled(bytes: ByteArray, target: Size, width: Int = 0, height: Int = 0): Bitmap? {
        val w = if (width > 0) width else BitmapFactory.Options().apply { inJustDecodeBounds = true }
            .also { BitmapFactory.decodeByteArray(bytes, 0, bytes.size, it) }.outWidth
        var sample = 1
        if (w > 0) while (w / (sample * 2) >= target.width) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: return null
        if (bmp.width == target.width && bmp.height == target.height) return bmp
        val scaled = Bitmap.createScaledBitmap(bmp, target.width, target.height, true)
        if (scaled !== bmp) bmp.recycle()
        return scaled
    }
}

/** A Photo Picker result, prepared off the main thread. */
class UriImageSource(private val resolver: ContentResolver, private val uri: Uri) : ImageSource {
    override suspend fun prepare(): Prepared =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) { ImagePrep.prepare(resolver, uri) }
}
