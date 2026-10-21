package com.okjudge.judge.core.evidence

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.api.ApiResult
import com.okjudge.judge.core.display.UiError
import com.okjudge.judge.core.model.EvidenceItemResult
import com.okjudge.judge.core.model.EvidenceUploadResponse
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.core.premium.TierAvailability
import com.okjudge.judge.ui.home.HomeUiState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EvidenceControllerTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @After
    fun tearDown() = scope.cancel()

    private fun image(tag: String) = ImageSource { Prepared.Ready(PreparedImage(tag.toByteArray(), "image/jpeg")) }

    private val fixture: EvidenceUploadResponse by lazy {
        WireJson.json.decodeFromString(EvidenceUploadResponse.serializer(), Fixtures.verdicts["evidenceResponse"].toString())
    }

    private fun okFor(vararg tokens: String) = EvidenceUploadResponse(
        tokens.mapIndexed { i, t -> EvidenceItemResult(index = i, status = "ok", kind = "chat", token = t, preview = "read $t") },
    )

    private suspend fun EvidenceController.settled(): EvidenceState =
        withTimeout(5_000) { state.first { !it.busy && it.items.isNotEmpty() } }

    @Test
    fun everyServerStatus_mapsToItsItem_andOnlyReadImagesGiveTokens() = runBlocking {
        val sent = mutableListOf<List<PreparedImage>>()
        val c = EvidenceController(scope, max = 6) { sent += it; ApiResult.Ok(fixture) }
        c.add(List(6) { image("img$it") })
        val st = c.settled()
        assertEquals(
            listOf(
                EvidenceStatus.OK, EvidenceStatus.UNREADABLE, EvidenceStatus.REFUSED,
                EvidenceStatus.UNSUPPORTED, EvidenceStatus.TOO_LARGE, EvidenceStatus.FAILED,
            ),
            st.items.map { it.status },
        )
        assertEquals(listOf(fixture.items[0].token), st.tokens)
        assertTrue(st.items[0].preview!!.startsWith("Sam: it's a hot dog"))
        assertNull(st.items[1].preview)
        assertEquals(listOf(1, 2, 3, 4, 5, 6), st.items.map { it.n })
        assertEquals(1, sent.size)
        assertEquals(6, sent.single().size)
    }

    @Test
    fun readingBlocksSubmit_untilTheUploadAnswers() = runBlocking {
        val gate = CompletableDeferred<ApiResult<EvidenceUploadResponse>>()
        val c = EvidenceController(scope, max = 3) { gate.await() }
        c.add(listOf(image("a")))
        val reading = c.state.value
        assertTrue(reading.busy)
        val home = HomeUiState(
            argument = "An argument that is clearly long enough to judge.",
            tierChoice = Tier.PREMIUM,
            availability = TierAvailability.AVAILABLE,
            features = Features(cases = true, evidence = true),
            evidence = reading,
        )
        assertTrue(home.evidenceOn)
        assertFalse("a screenshot still reading holds the button", home.canSubmit)
        assertTrue("free ignores the picker", home.copy(tierChoice = Tier.FREE).canSubmit)
        gate.complete(ApiResult.Ok(okFor("t1")))
        val done = c.settled()
        assertTrue(home.copy(evidence = done).canSubmit)
        assertEquals(listOf("t1"), done.tokens)
    }

    @Test
    fun tokensFollowTheItemOrder_acrossUploads_andRemoval() = runBlocking {
        var call = 0
        val c = EvidenceController(scope, max = 3) {
            call += 1
            ApiResult.Ok(if (call == 1) okFor("first", "second") else okFor("third"))
        }
        c.add(listOf(image("1"), image("2")))
        c.settled()
        c.add(listOf(image("3")))
        withTimeout(5_000) { c.state.first { it.tokens.size == 3 } }
        assertEquals(listOf("first", "second", "third"), c.state.value.tokens)
        assertTrue(c.state.value.full)
        c.remove(c.state.value.items[1].id)
        assertEquals(listOf("first", "third"), c.state.value.tokens)
        assertEquals(listOf(1, 3), c.state.value.items.map { it.n })
    }

    @Test
    fun undecodableAndOversizedPicks_neverUpload_andIndexesStayAligned() = runBlocking {
        val sent = mutableListOf<List<PreparedImage>>()
        val c = EvidenceController(scope, max = 3) { sent += it; ApiResult.Ok(okFor("only")) }
        c.add(listOf(ImageSource { Prepared.Unsupported }, image("good"), ImageSource { Prepared.TooLarge }))
        val st = withTimeout(5_000) { c.state.first { !it.busy } }
        assertEquals(listOf(EvidenceStatus.UNSUPPORTED, EvidenceStatus.OK, EvidenceStatus.TOO_LARGE), st.items.map { it.status })
        assertEquals("good", String(sent.single().single().bytes))
        assertEquals(listOf("only"), st.tokens)
    }

    @Test
    fun pickingMoreThanFits_keepsWhatFits_andSaysSo() = runBlocking {
        val c = EvidenceController(scope, max = 3) { ApiResult.Ok(okFor("a", "b", "c")) }
        c.add(List(5) { image("x$it") })
        assertTrue(c.state.value.overLimit)
        assertEquals(3, c.state.value.items.size)
        c.settled()
        c.add(listOf(image("late")))
        assertEquals(3, c.state.value.items.size)
        c.remove(c.state.value.items[0].id)
        assertFalse(c.state.value.overLimit)
    }

    @Test
    fun aFailedUpload_marksItsItemsFailed_andKeepsTheError() = runBlocking {
        val error = UiError.Api(code = "too_large", status = 413)
        val c = EvidenceController(scope, max = 3) { ApiResult.Err(error) }
        c.add(listOf(image("a"), image("b")))
        val st = c.settled()
        assertEquals(listOf(EvidenceStatus.FAILED, EvidenceStatus.FAILED), st.items.map { it.status })
        assertEquals(error, st.failure)
        assertTrue(st.tokens.isEmpty())
    }

    @Test
    fun anItemRemovedWhileReading_ignoresItsResult() = runBlocking {
        val gate = CompletableDeferred<ApiResult<EvidenceUploadResponse>>()
        val c = EvidenceController(scope, max = 3) { gate.await() }
        c.add(listOf(image("a"), image("b")))
        val first = c.state.value.items[0].id
        c.remove(first)
        gate.complete(ApiResult.Ok(okFor("ta", "tb")))
        val st = c.settled()
        assertEquals(1, st.items.size)
        assertEquals(listOf("tb"), st.tokens)
    }

    @Test
    fun okWithoutAToken_readsAsFailed() {
        val items = listOf(EvidenceItem("ev1", 1, EvidenceStatus.READING))
        val out = EvidenceController.applyUploadResult(items, listOf("ev1"), EvidenceUploadResponse(listOf(EvidenceItemResult(0, "ok"))))
        assertEquals(EvidenceStatus.FAILED, out.single().status)
        val missing = EvidenceController.applyUploadResult(items, listOf("ev1"), EvidenceUploadResponse(emptyList()))
        assertEquals(EvidenceStatus.FAILED, missing.single().status)
        val unknown = EvidenceController.applyUploadResult(items, listOf("ev1"), EvidenceUploadResponse(listOf(EvidenceItemResult(0, "brand_new"))))
        assertEquals(EvidenceStatus.FAILED, unknown.single().status)
    }

    @Test
    fun fitWithin_andKeepOriginal_matchTheWeb() {
        assertEquals(ImagePrep.Size(1600, 500, true), ImagePrep.fitWithin(3200, 1000))
        assertEquals(ImagePrep.Size(900, 1600, true), ImagePrep.fitWithin(1170, 2080))
        assertEquals(ImagePrep.Size(1600, 900, false), ImagePrep.fitWithin(1600, 900))
        assertTrue(ImagePrep.keepOriginal("image/png", 1200, 800, 400_000))
        assertTrue(ImagePrep.keepOriginal("image/gif", 1600, 1600, ImagePrep.MAX_IMAGE_BYTES))
        assertFalse(ImagePrep.keepOriginal("image/png", 1601, 800, 400_000))
        assertFalse(ImagePrep.keepOriginal("image/png", 1200, 800, ImagePrep.MAX_IMAGE_BYTES + 1))
        assertFalse("JPEG is always re-encoded (drops EXIF)", ImagePrep.keepOriginal("image/jpeg", 800, 600, 10_000))
        assertFalse(ImagePrep.keepOriginal("image/webp", 800, 600, 10_000))
    }
}
