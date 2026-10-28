package com.okjudge.judge.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.model.HistoryPage
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.core.model.decodeHistoryPage
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalizedStrings
import com.okjudge.judge.i18n.ProvideLang
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.components.LocalSceneLive
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.theme.JudgeTheme
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.CardActions
import com.okjudge.judge.ui.verdict.TranslationStatus
import com.okjudge.judge.ui.verdict.TranslationView
import com.okjudge.judge.ui.verdict.RulingSummary
import com.okjudge.judge.ui.verdict.VerdictDetails
import java.io.File

object UiTestSupport {
    val strings: LocalizedStrings by lazy { LocalizedStrings(ApplicationProvider.getApplicationContext()) }

    fun s(lang: AppLang): Strings = strings.of(lang)

    /** Where screenshots go: -Pjudge.shotsDir=..., else build/outputs/roborazzi. */
    fun shot(name: String): String {
        val dir = System.getProperty("judge.shotsDir")?.takeIf { it.isNotBlank() } ?: "build/outputs/roborazzi"
        File(dir).mkdirs()
        return File(dir, "$name.png").path
    }
}

/** Theme + language locals, on the ivory background, with the flat balance for the scene. */
@Composable
fun Themed(lang: AppLang, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalSceneLive provides false) {
        ProvideLang(lang, UiTestSupport.s(lang)) {
            JudgeTheme {
                Box(Modifier.background(Palette.ivory)) { content() }
            }
        }
    }
}

/**
 * A fixture sample rendered like a fresh verdict (labels from its name map,
 * real names restored in the text as VerdictRoute does): its details, or
 * the ruling at a glance with [summary]. Shown in another
 * language, it carries the fixture translation when there is one for it (as
 * the iOS screenshot states do), unless [status] asks for a specific pill.
 */
@Composable
fun SampleVerdict(
    outcome: VerdictOutcome,
    lang: AppLang,
    modifier: Modifier = Modifier,
    status: TranslationStatus = TranslationStatus.ORIGINAL,
    summary: Boolean = false,
) {
    val selfLang = ContentLang.verdictLang(outcome.result.result)
    val s = UiTestSupport.s(lang)
    val view = sampleView(outcome, lang, status).personalized(outcome.nameMap, selfLang)
    val parties = PartyNames.partyNames(outcome.nameMap, selfLang, s)
    val actions = CardActions(onShare = {}, onCopy = {}, copied = false)
    val restored = PartyNames.restoredNames(outcome.nameMap, selfLang)
    if (summary) {
        RulingSummary(view, parties, actions, onDetails = {}, reducedMotion = true, modifier = modifier, restoredNames = restored)
    } else {
        VerdictDetails(view, parties, restored, actions, modifier)
    }
}

fun sample(name: String): VerdictOutcome = Fixtures.sample(name)

/** The `history` page of verdicts.json, as GET /api/v1/me/history answers. */
fun historyPage(): HistoryPage = decodeHistoryPage(Fixtures.verdicts["history"].toString())

/** A fixture sample kept on the phone, as of [at] (epoch ms). */
fun savedSample(name: String, at: Long, owner: String? = null): SavedVerdict {
    val o = sample(name)
    return SavedVerdict(o.id, at, o.result, o.nameMap, emptyMap(), ownerUserId = owner)
}

fun phoneRows(vararg names: String, newest: Long = 1_760_900_000_000L): List<HistoryEntry> =
    names.mapIndexed { i, n -> HistoryEntry.Phone(savedSample(n, newest - i * 86_400_000L)) }

/** What [SampleVerdict] shows for [outcome] in [lang]. */
fun sampleView(outcome: VerdictOutcome, lang: AppLang, status: TranslationStatus = TranslationStatus.ORIGINAL): TranslationView {
    val original = outcome.result.result
    val selfLang = ContentLang.verdictLang(original)
    val translated = if (status == TranslationStatus.ORIGINAL && lang != selfLang) Fixtures.translationOf(outcome.id, lang) else null
    return if (translated != null) {
        TranslationView(translated, TranslationStatus.TRANSLATED, selfLang)
    } else {
        TranslationView(original, status, selfLang)
    }
}
