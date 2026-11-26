package com.okjudge.judge.ui.verdict

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.okjudge.judge.core.feedback.Agreement
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.LabeledCheckbox
import com.okjudge.judge.ui.components.PrimaryButton
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object AgreementTags {
    const val SHEET = "agreement.sheet"
    const val CONTINUE = "agreement.continue"
    const val ERROR = "agreement.error"
}

/** The private details tick, asked before a person's first verdict; Continue stays off until it is ticked. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgreementSheet(state: Agreement.State, onContinue: () -> Unit, onDismiss: () -> Unit) {
    val s = LocalStrings.current
    var ticked by rememberSaveable { mutableStateOf(false) }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Palette.paper,
        scrimColor = Palette.ink.copy(alpha = 0.42f),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        dragHandle = { Box(Modifier.padding(top = 10.dp).size(width = 40.dp, height = 5.dp).clip(JudgeShapes.chip).background(Palette.stone)) },
    ) {
        Column(
            Modifier
                .testTag(AgreementTags.SHEET)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(start = 20.dp, top = 8.dp, end = 20.dp, bottom = 24.dp),
        ) {
            Text(s.consentSensitiveTitle, style = JudgeType.sectionTitle, modifier = Modifier.semantics { heading() })
            LabeledCheckbox(ticked, { ticked = it }, s.consentSensitiveBody, Modifier.padding(top = 16.dp), enabled = !state.busy)
            if (state.failed) {
                Text(
                    s.errorFallback,
                    style = JudgeType.body.copy(color = Palette.ink),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .clip(JudgeShapes.field)
                        .background(Palette.terraTint)
                        .testTag(AgreementTags.ERROR)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                )
            }
            PrimaryButton(
                text = s.consentSensitiveContinue,
                enabled = ticked && !state.busy,
                onClick = onContinue,
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp).testTag(AgreementTags.CONTINUE),
            )
        }
    }
}
