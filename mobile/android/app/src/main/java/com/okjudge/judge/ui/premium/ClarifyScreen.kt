package com.okjudge.judge.ui.premium

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.model.ClarifyQuestion
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object ClarifyTags {
    const val SUBMIT = "clarify.submit"
    const val SKIP = "clarify.skip"
    const val BACK = "clarify.back"
    fun answer(i: Int) = "clarify.answer.$i"
}

/**
 * Premium's clarifying step (components/ClarifyStep.tsx): up to two short
 * questions, each with an optional answer (500 characters at most), then
 * "Get the verdict" or "Skip and judge"; back returns to the form.
 */
@Composable
fun ClarifyScreen(
    questions: List<ClarifyQuestion>,
    answers: Map<String, String>,
    onAnswer: (id: String, value: String) -> Unit,
    onSubmit: () -> Unit,
    onSkip: () -> Unit,
    onBack: () -> Unit,
    onNew: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val rtl = LocalLang.current.rtl
    BackHandler(onBack = onBack)
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = onBack, onNew = onNew, backLabel = s.clarifyBack)
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(top = 12.dp, bottom = 40.dp)) {
                Text(
                    s.clarifyTitle,
                    style = JudgeType.sectionTitle.copy(fontSize = JudgeType.sectionTitle.fontSize * 1.3f),
                    modifier = Modifier.padding(top = 10.dp).semantics { heading() },
                )
                Text(s.clarifyLead, style = JudgeType.lead, modifier = Modifier.padding(top = 10.dp, bottom = 20.dp))
                questions.take(VerdictFlow.MAX_QUESTIONS).forEachIndexed { i, q ->
                    Text(q.text, style = JudgeType.bodyStrong, modifier = Modifier.padding(top = if (i > 0) 18.dp else 0.dp, bottom = 8.dp))
                    AnswerField(
                        value = answers[q.id] ?: "",
                        onChange = { onAnswer(q.id, it.take(VerdictFlow.MAX_ANSWER)) },
                        placeholder = s.clarifyPlaceholder,
                        label = s.clarifyAnswerAria((i + 1).toString()),
                        modifier = Modifier.testTag(ClarifyTags.answer(i)),
                    )
                }
                PrimaryButton(
                    text = s.clarifySubmit + if (rtl) "  ←" else "  →",
                    enabled = true,
                    onClick = onSubmit,
                    modifier = Modifier.fillMaxWidth().padding(top = 28.dp).testTag(ClarifyTags.SUBMIT),
                )
                Box(Modifier.fillMaxWidth().padding(top = 10.dp), contentAlignment = Alignment.Center) {
                    TextAction(s.clarifySkip, onSkip, Modifier.testTag(ClarifyTags.SKIP), color = Palette.ink)
                }
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    TextAction((if (rtl) "→ " else "← ") + s.clarifyBack, onBack, Modifier.testTag(ClarifyTags.BACK), color = Palette.ink2)
                }
            }
        }
    }
}

@Composable
private fun AnswerField(value: String, onChange: (String) -> Unit, placeholder: String, label: String, modifier: Modifier) {
    Box(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 84.dp)
            .clip(JudgeShapes.field)
            .background(Palette.paper)
            .border(1.dp, Palette.line2, JudgeShapes.field)
            .padding(14.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = onChange,
            textStyle = JudgeType.body,
            cursorBrush = SolidColor(Palette.terraInk),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
            modifier = modifier.fillMaxWidth().heightIn(min = 56.dp).semantics { contentDescription = label },
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, style = JudgeType.body.copy(color = Palette.placeholder))
                inner()
            },
        )
    }
}
