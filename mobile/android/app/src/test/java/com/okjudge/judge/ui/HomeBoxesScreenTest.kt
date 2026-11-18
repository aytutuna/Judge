package com.okjudge.judge.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import com.okjudge.judge.core.model.Features
import com.okjudge.judge.core.cases.AppealArea
import com.okjudge.judge.core.cases.CaseLogic
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.cases.AppealDraft
import com.okjudge.judge.ui.cases.AppealFormActions
import com.okjudge.judge.ui.cases.AppealPanel
import com.okjudge.judge.ui.cases.CaseTags
import com.okjudge.judge.ui.home.ExtraSide
import com.okjudge.judge.ui.home.HomeScreen
import com.okjudge.judge.ui.home.HomeTags
import com.okjudge.judge.ui.home.HomeUiState
import com.okjudge.judge.ui.theme.DarkPalette
import com.okjudge.judge.ui.theme.LightPalette
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w400dp-h2600dp-xhdpi")
class HomeBoxesScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val sam = "Sam says a hot dog is a sandwich and I say it is not."

    private fun home(initial: HomeUiState, onSubmit: () -> Unit = {}) {
        compose.setContent {
            Themed(AppLang.EN) {
                var state by remember { mutableStateOf(initial) }
                HomeScreen(
                    state = state,
                    onArgumentChange = { state = state.copy(argument = it) },
                    onSubmit = onSubmit,
                    onDismissError = {},
                    onOtherSideChange = { state = state.copy(otherSide = it) },
                    onExtraSide = { i, text -> state = state.copy(more = state.more.mapIndexed { j, e -> if (i == j) e.copy(text = text) else e }) },
                    onAddSide = { state = state.copy(more = state.more + ExtraSide()) },
                    onClear = { state = HomeUiState() },
                )
            }
        }
    }

    private fun lifted() = compose.onAllNodesWithTag(HomeTags.LIFTED).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun aTapLiftsABox_theTextIsWrittenThere_andTheScrimPutsItBack() {
        home(HomeUiState(argument = sam, theirsOpen = true))
        assertFalse(lifted())
        compose.onNodeWithTag(HomeTags.OTHER).performClick()
        assertTrue(lifted())
        compose.onNodeWithTag(HomeTags.OTHER).performTextInput("It is not a sandwich.")
        compose.onNodeWithTag(HomeTags.SCRIM).performClick()
        compose.waitUntil(2_000) { !lifted() }
        compose.onNodeWithTag(HomeTags.OTHER).performClick()
        compose.onNodeWithTag(HomeTags.OTHER).assertExists()
        assertTrue(lifted())
    }

    @Test
    fun draggingALiftedBoxAway_putsItBack() {
        home(HomeUiState(argument = sam, theirsOpen = true))
        compose.onNodeWithTag(HomeTags.OTHER).performClick()
        assertTrue(lifted())
        compose.onNodeWithTag(HomeTags.LIFTED).performTouchInput { swipeDown(startY = 8f, endY = 400f, durationMillis = 120) }
        compose.waitUntil(3_000) { !lifted() }
    }

    @Test
    fun clearSitsInTheSendRow_nextToSend_onlyOnceThereIsSomethingToClear() {
        home(HomeUiState())
        compose.onNodeWithTag(HomeTags.CLEAR).assertDoesNotExist()
        compose.onNodeWithTag(HomeTags.INPUT).performTextInput(sam)
        val clear = compose.onNodeWithTag(HomeTags.CLEAR).fetchSemanticsNode().boundsInRoot
        val send = compose.onNodeWithTag(HomeTags.SUBMIT).fetchSemanticsNode().boundsInRoot
        val counter = compose.onNodeWithTag(HomeTags.COUNTER).fetchSemanticsNode().boundsInRoot
        assertTrue(clear.right <= send.left)
        assertTrue(counter.right <= clear.left)
        assertEquals(clear.center.y, send.center.y, 4f)
        compose.onNodeWithTag(HomeTags.CLEAR).performClick()
        compose.onNodeWithTag(HomeTags.CLEAR).assertDoesNotExist()
    }

    @Test
    fun addSide_isThereWhileFewerThanFourSides_evenWithEmptyBoxes_andOffWhileBusy() {
        home(HomeUiState(theirsOpen = true, features = Features(cases = true)))
        compose.onNodeWithTag(HomeTags.ADD_SIDE).assertIsEnabled().performClick()
        compose.onNodeWithTag(HomeTags.ADD_SIDE).assertIsEnabled().performClick()
        compose.onNodeWithTag(HomeTags.ADD_SIDE).assertDoesNotExist()

        val busy = HomeUiState(theirsOpen = true, features = Features(cases = true), checking = true)
        assertTrue(busy.showsAddSide)
        assertFalse(busy.copy(more = listOf(ExtraSide(), ExtraSide())).showsAddSide)
        assertFalse(busy.copy(theirsOpen = false).showsAddSide)
    }

    @Test
    fun theGamifyRuby_isTheSameInLightAndDarkExceptItsInk() {
        assertEquals(Color(0xFFB5123A), LightPalette.ruby)
        assertEquals(Color(0xFFB5123A), DarkPalette.ruby)
        assertEquals(Color(0xFF9B0E31), LightPalette.rubyInk)
        assertEquals(Color(0xFFF0567A), DarkPalette.rubyInk)
    }

    @Test
    fun theAppealCounter_sitsInsideTheTextBox_atTheBottomRight() {
        compose.setContent {
            Themed(AppLang.EN) {
                AppealPanel(
                    area = AppealArea.Form(null),
                    draft = AppealDraft(text = "Some more context for the judges."),
                    evidenceOn = false,
                    cost = "",
                    actions = AppealFormActions(),
                    onClose = {},
                )
            }
        }
        val box = compose.onNodeWithTag(CaseTags.APPEAL_TEXT).fetchSemanticsNode().boundsInRoot
        val counter = compose.onNodeWithTag(CaseTags.APPEAL_COUNTER).fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag(CaseTags.APPEAL_COUNTER).assertTextEquals("33 / ${CaseLogic.MAX_APPEAL_CHARS}")
        assertTrue(counter.right >= box.right - 4f && counter.bottom >= box.bottom - 4f)
        assertTrue(counter.top >= box.top)
    }
}
