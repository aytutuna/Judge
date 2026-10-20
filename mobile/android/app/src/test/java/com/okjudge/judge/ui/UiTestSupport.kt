package com.okjudge.judge.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.display.ContentLang
import com.okjudge.judge.core.display.PartyNames
import com.okjudge.judge.core.model.VerdictOutcome
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.i18n.LocalizedStrings
import com.okjudge.judge.i18n.Strings
import com.okjudge.judge.ui.theme.JudgeTheme
import com.okjudge.judge.ui.theme.Palette
import com.okjudge.judge.ui.verdict.CardActions
import com.okjudge.judge.ui.verdict.TranslationStatus
import com.okjudge.judge.ui.verdict.TranslationView
import com.okjudge.judge.ui.verdict.VerdictContent
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

/** Theme + language locals, on the ivory background. */
@Composable
fun Themed(lang: AppLang, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalLang provides lang, LocalStrings provides UiTestSupport.s(lang)) {
        JudgeTheme {
            Box(Modifier.background(Palette.ivory)) { content() }
        }
    }
}

/**
 * A fixture sample rendered like a fresh verdict (labels from its name map,
 * real names restored in the text as VerdictRoute does). Shown in another
 * language, it carries the fixture translation when there is one for it (as
 * the iOS screenshot states do), unless [status] asks for a specific pill.
 */
@Composable
fun SampleVerdict(outcome: VerdictOutcome, lang: AppLang, modifier: Modifier = Modifier, status: TranslationStatus = TranslationStatus.ORIGINAL) {
    val selfLang = ContentLang.verdictLang(outcome.result.result)
    val s = UiTestSupport.s(lang)
    VerdictContent(
        view = sampleView(outcome, lang, status).personalized(outcome.nameMap, selfLang),
        parties = PartyNames.partyNames(outcome.nameMap, selfLang, s),
        restoredNames = PartyNames.restoredNames(outcome.nameMap, selfLang),
        actions = CardActions(onShare = {}, onCopy = {}, copied = false, onJudgeAnother = {}),
        modifier = modifier,
    )
}

fun sample(name: String): VerdictOutcome = Fixtures.sample(name)

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
