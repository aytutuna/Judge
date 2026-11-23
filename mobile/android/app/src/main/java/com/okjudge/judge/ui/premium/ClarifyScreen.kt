package com.okjudge.judge.ui.premium

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.semantics.Role
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
import com.okjudge.judge.ui.components.dragDismissesKeyboard
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.components.TextAction
import com.okjudge.judge.ui.components.TopBar
import com.okjudge.judge.ui.components.clearFocusOnTap
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object ClarifyTags {
    const val SUBMIT = "clarify.submit"
    const val SKIP = "clarify.skip"
    const val BACK = "clarify.back"
    fun answer(i: Int) = "clarify.answer.$i"
    fun option(i: Int, k: Int) = "clarify.option.$i.$k"
    fun other(i: Int) = "clarify.other.$i"
}

/**
 * Premium's clarifying step (components/ClarifyStep.tsx): up to two short
 * questions, each answered by tapping a likely answer or Other (a text box
 * of 500 characters at most), or left empty, then
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
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val rtl = LocalLang.current.rtl
    BackHandler(onBack = onBack)
    Column(modifier.fillMaxSize()) {
        TopBar(onBack = onBack, backLabel = s.clarifyBack)
        val scroll = rememberScrollState()
        Column(
            Modifier.fillMaxSize().clearFocusOnTap().dragDismissesKeyboard().verticalScroll(scroll).imePadding().padding(horizontal = 20.dp),
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
                    if (q.options.isEmpty()) {
                        AnswerField(
                            value = answers[q.id] ?: "",
                            onChange = { onAnswer(q.id, it.take(VerdictFlow.MAX_ANSWER)) },
                            placeholder = s.clarifyPlaceholder,
                            label = s.clarifyAnswerAria((i + 1).toString()),
                            modifier = Modifier.testTag(ClarifyTags.answer(i)),
                        )
                    } else {
                        Choices(i, q, answers[q.id] ?: "") { onAnswer(q.id, it.take(VerdictFlow.MAX_ANSWER)) }
                    }
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

private const val OTHER = -2
private const val NONE = -1

/** The options as single-select chips plus Other; Other reveals the text box. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Choices(i: Int, q: ClarifyQuestion, answer: String, onAnswer: (String) -> Unit) {
    val s = LocalStrings.current
    var pick by rememberSaveable(q.id) {
        mutableIntStateOf(q.options.indexOf(answer).let { if (it >= 0) it else if (answer.isNotEmpty()) OTHER else NONE })
    }
    // Kept while an option is picked, so choosing Other again restores it.
    var typed by rememberSaveable(q.id) { mutableStateOf(if (pick == OTHER) answer else "") }
    val focus = remember { FocusRequester() }
    var focusOther by remember { mutableStateOf(false) }
    LaunchedEffect(focusOther) { if (focusOther) focus.requestFocus() }

    fun choose(next: Int) {
        pick = if (pick == next) NONE else next
        focusOther = pick == OTHER
        onAnswer(
            when (pick) {
                NONE -> ""
                OTHER -> typed
                else -> q.options[pick]
            },
        )
    }

    Column(Modifier.selectableGroup()) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            q.options.forEachIndexed { k, text -> Choice(text, pick == k, Modifier.testTag(ClarifyTags.option(i, k))) { choose(k) } }
            Choice(s.clarifyOther, pick == OTHER, Modifier.testTag(ClarifyTags.other(i))) { choose(OTHER) }
        }
        if (pick == OTHER) {
            AnswerField(
                value = typed,
                onChange = {
                    typed = it.take(VerdictFlow.MAX_ANSWER)
                    onAnswer(typed)
                },
                placeholder = s.clarifyPlaceholder,
                label = s.clarifyAnswerAria((i + 1).toString()),
                modifier = Modifier.focusRequester(focus).testTag(ClarifyTags.answer(i)),
                outer = Modifier.padding(top = 10.dp),
            )
        }
    }
}

@Composable
private fun Choice(text: String, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .heightIn(min = 44.dp)
            .clip(JudgeShapes.chip)
            .background(if (selected) Palette.ink else Palette.paper)
            .border(1.dp, if (selected) Palette.ink else Palette.line2, JudgeShapes.chip)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = JudgeType.bodyStrong.copy(color = if (selected) Palette.ivory else Palette.ink))
    }
}

@Composable
private fun AnswerField(value: String, onChange: (String) -> Unit, placeholder: String, label: String, modifier: Modifier, outer: Modifier = Modifier) {
    Box(
        outer
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
