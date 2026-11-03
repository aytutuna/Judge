package com.okjudge.judge.core.evidence

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.model.EvidenceUploadResponse
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

/** Real decoding and encoding (Robolectric's native graphics), and the multipart upload. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class ImagePrepTest {
    private fun png(width: Int, height: Int, transparent: Boolean = false): ByteArray {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(if (transparent) Color.TRANSPARENT else Color.rgb(200, 85, 61))
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return out.toByteArray()
    }

    private fun bounds(bytes: ByteArray): BitmapFactory.Options =
        BitmapFactory.Options().apply { inJustDecodeBounds = true }.also { BitmapFactory.decodeByteArray(bytes, 0, bytes.size, it) }

    @Test
    fun aLargeScreenshot_isDownscaledToTheLongEdge_asJpeg() {
        val prepared = ImagePrep.prepare(png(3200, 1000), "image/png")!!
        assertEquals("image/jpeg", prepared.mimeType)
        assertEquals("jpg", prepared.extension)
        val b = bounds(prepared.bytes)
        assertEquals("image/jpeg", b.outMimeType)
        assertEquals(1600, b.outWidth)
        assertEquals(500, b.outHeight)
        assertNotNull(prepared.thumbnail)
        assertTrue(prepared.thumbnail!!.width <= 160)
    }

    @Test
    fun aSmallPng_isSentUntouched() {
        val original = png(800, 600)
        val prepared = ImagePrep.prepare(original, "image/png")!!
        assertEquals("image/png", prepared.mimeType)
        assertArrayEquals(original, prepared.bytes)
    }

    @Test
    fun transparency_becomesAWhitePage() {
        val prepared = ImagePrep.prepare(png(2000, 2000, transparent = true), "image/png")!!
        val decoded = BitmapFactory.decodeByteArray(prepared.bytes, 0, prepared.bytes.size)
        val px = decoded.getPixel(10, 10)
        assertTrue("white, not black: ${Integer.toHexString(px)}", Color.red(px) > 240 && Color.green(px) > 240 && Color.blue(px) > 240)
    }

    @Test
    fun garbage_cannotBePrepared() {
        assertNull(ImagePrep.prepare("not an image".toByteArray(), "image/png"))
    }

    @Test
    fun upload_sendsMultipartImageParts_inOrder() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(
                MockResponse.Builder().code(200).addHeader("Content-Type", "application/json")
                    .body("""{"items":[{"index":0,"status":"ok","kind":"chat","token":"t0","preview":"p","expiresAt":null},{"index":1,"status":"unreadable","kind":null,"token":null,"preview":null,"expiresAt":null}]}""")
                    .build(),
            )
            val api = JudgeApi(server.url("/").toString(), OkHttpClient(), "ua")
            val res = api.uploadEvidence(listOf(PreparedImage(byteArrayOf(1, 2, 3), "image/jpeg"), PreparedImage(byteArrayOf(4), "image/png")))
            val body = (res as ApiResult.Ok<EvidenceUploadResponse>).value
            assertEquals(listOf("ok", "unreadable"), body.items.map { it.status })
            val req = server.takeRequest()
            assertEquals("/api/v1/evidence", req.url.encodedPath)
            assertTrue(req.headers["Content-Type"]!!.startsWith("multipart/form-data"))
            val text = req.body!!.utf8()
            assertEquals(2, Regex("""name="image"""").findAll(text).count())
            assertTrue(text.indexOf("""filename="image-1.jpg"""") in 0 until text.indexOf("""filename="image-2.png""""))
            assertTrue(text.contains("Content-Type: image/png"))
        } finally {
            server.close()
        }
    }
}
