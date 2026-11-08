package com.okjudge.judge.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import com.okjudge.judge.ui.components.LocalSceneLive
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

private val cache = LruCache<String, Bitmap>(8)

/** Largest power of two that keeps both sides at or above [target] pixels. */
internal fun sampleSize(width: Int, height: Int, target: Int): Int {
    var sample = 1
    while (width / (sample * 2) >= target && height / (sample * 2) >= target) sample *= 2
    return sample
}

private const val MAX_BYTES = 5 * 1024 * 1024

private fun readCapped(input: java.io.InputStream): ByteArray? {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    while (true) {
        val n = input.read(buf)
        if (n < 0) return out.toByteArray()
        if (out.size() + n > MAX_BYTES) return null
        out.write(buf, 0, n)
    }
}

private fun download(conn: HttpURLConnection): Bitmap? {
    conn.connectTimeout = 8_000
    conn.readTimeout = 8_000
    return try {
        val bytes = conn.inputStream.use { readCapped(it) } ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, 128) }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    } finally {
        conn.disconnect()
    }
}

/** The user's picture as a circle; draws nothing until it has loaded, or if it never does. */
@Composable
internal fun AvatarImage(url: String?, modifier: Modifier = Modifier) {
    val live = LocalSceneLive.current && !LocalInspectionMode.current
    if (url == null || !live || !url.startsWith("https://")) return
    var bitmap by remember(url) { mutableStateOf(cache.get(url)) }
    LaunchedEffect(url) {
        if (bitmap != null) return@LaunchedEffect
        bitmap = withTimeoutOrNull(20_000) {
            withContext(Dispatchers.IO) {
                val conn = URL(url).openConnection() as HttpURLConnection
                // the read blocks and ignores cancellation, so cut the socket
                coroutineContext.job.invokeOnCompletion { if (it != null) conn.disconnect() }
                try {
                    download(conn)?.also { cache.put(url, it) }
                } catch (e: Exception) {
                    null
                } catch (e: OutOfMemoryError) {
                    null
                }
            }
        }
    }
    bitmap?.let {
        Image(
            it.asImageBitmap(),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = modifier.fillMaxSize().clip(CircleShape).clearAndSetSemantics {},
        )
    }
}
