package com.okjudge.judge.ui

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.history.HistoryLabels
import com.okjudge.judge.ui.history.HistoryNotice
import com.okjudge.judge.ui.history.HistoryPaging
import com.okjudge.judge.ui.history.HistoryScreen
import com.okjudge.judge.ui.history.HistoryTags
import com.okjudge.judge.ui.history.mergeHistory
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], qualifiers = "w400dp-h2600dp-xhdpi")
class HistoryScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val en = UiTestSupport.s(AppLang.EN)
    private val page = historyPage()
    private val now = Instant.parse("2026-10-21T08:00:00Z").toEpochMilli()
    private val phone = savedSample("win_b_named", Instant.parse("2026-10-17T08:00:00Z").toEpochMilli())
    private val entries = mergeHistory(page.items, listOf(phone), user = "u1")

    private fun item(id: String) = page.items.first { it.id == id }

    @Test
    fun eachRow_saysWhereItStands_fromTheViewersSide() {
        compose.setContent { Themed(AppLang.EN) { HistoryScreen(entries, {}, { _, _ -> }, {}, now = now) } }
        compose.onNodeWithText("Waiting for Sam to answer").assertExists()
        compose.onNodeWithText(en.historyStateJudging).assertExists()
        compose.onNodeWithText(en.shellUntitled).assertExists()
        compose.onNodeWithText(en.historyStateExpired).assertExists()
        compose.onNodeWithText(en.historyYourMove).assertExists()
        // The verdict the viewer wrote and the case they answered both went their way.
        compose.onAllNodesWithText(en.verdictWinSelf).assertCountEquals(2)
        compose.onNodeWithText(en.verdictWin("Sam")).assertExists()
        compose.onNodeWithText(en.historyContextAdded, substring = true).assertExists()
        compose.onNodeWithText(en.historyAnswered, substring = true).assertExists()
        compose.onNodeWithText("Alex owes half the deposit").assertExists()
        compose.onNodeWithText(en.historyStateRemovedBy("Sam")).assertExists()
        compose.onNodeWithText(en.appHistoryPhoneOnly, substring = true).assertExists()
        compose.onNodeWithTag(HistoryTags.PHONE_NOTE).performScrollTo().assertExists()
        assertEquals(
            listOf("c:case0000010", "v:verdict0020", "c:case0000011", "v:verdict0021", "v:${phone.id}", "c:case0000012", "c:case0000013", "c:case0000014"),
            entries.map { it.key },
        )
    }

    @Test
    fun rowsOpen_exceptOnesStillBeingJudged() {
        val opened = mutableListOf<String>()
        compose.setContent { Themed(AppLang.EN) { HistoryScreen(entries, { opened += it.key }, { _, _ -> }, {}, now = now) } }
        compose.onNodeWithTag(HistoryTags.row("c:case0000013")).performClick()
        compose.onNodeWithTag(HistoryTags.row("v:verdict0020")).performClick()
        compose.onNodeWithTag(HistoryTags.row("c:case0000014")).performClick()
        compose.onNodeWithTag(HistoryTags.row("v:${phone.id}")).performClick()
        assertEquals(listOf("c:case0000013", "c:case0000014", "v:${phone.id}"), opened)
    }

    @Test
    fun selectMode_picksRemovableRows_andAsksInPlainWords() {
        val removed = mutableListOf<List<String>>()
        var failNext = emptySet<String>()
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(entries, {}, { picked, done -> removed += picked.map { it.key }; done(failNext) }, {}, now = now)
            }
        }
        compose.onNodeWithTag(HistoryTags.SELECT).performClick()
        compose.onNodeWithText(en.appHistorySelectAll).performClick()
        compose.onNodeWithText(en.appHistorySelected(6)).assertExists()
        compose.onNodeWithText(en.appHistoryDeselectAll).performClick()

        // Not removable from here: the judging verdict and the case the other side removed.
        compose.onNodeWithTag(HistoryTags.row("v:verdict0020")).performClick()
        compose.onNodeWithText(en.appHistorySelected(0)).assertExists()

        compose.onNodeWithTag(HistoryTags.row("v:verdict0021")).performClick()
        compose.onNodeWithTag(HistoryTags.row("v:${phone.id}")).performClick()
        compose.onNodeWithTag(HistoryTags.DELETE).assertIsEnabled().performClick()
        compose.onNodeWithText(en.appHistoryRemoveConfirm(1) + " " + en.appHistoryPhoneOnlyAlso(1)).assertExists()
        compose.onNodeWithText(
            "Remove this verdict from your account? What you wrote and the names are erased and its share link stops working, on every device. This can't be undone.",
            substring = true,
        ).assertExists()

        // One fails: it stays picked, select mode stays.
        failNext = setOf("v:verdict0021")
        compose.onNodeWithTag(HistoryTags.CONFIRM_DELETE).performClick()
        assertEquals(setOf("v:verdict0021", "v:${phone.id}"), removed.single().toSet())
        compose.onNodeWithText(en.appHistorySelected(1)).assertExists()
        compose.onNodeWithTag(HistoryTags.row("v:verdict0021"))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, en.appHistoryRowSelected))

        failNext = emptySet()
        compose.onNodeWithTag(HistoryTags.DELETE).performClick()
        compose.onNodeWithText(en.appHistoryRemoveConfirm(1)).assertExists()
        compose.onNodeWithTag(HistoryTags.CONFIRM_DELETE).performClick()
        compose.onNodeWithTag(HistoryTags.SELECT).assertExists()
        compose.onNodeWithTag(HistoryTags.CANCEL).assertDoesNotExist()
    }

    @Test
    fun phoneRowsAlone_keepTheDeleteFromThisPhoneWording() {
        val rows = phoneRows("win_a_self", "lean_tie")
        assertEquals("Delete 2 verdicts from this phone? Their share links keep working.", HistoryLabels.removeConfirm(rows, en))
        assertEquals("Delete this verdict from this phone? Its share link keeps working.", HistoryLabels.removeConfirm(rows.take(1), en))
        val account = listOf(HistoryEntry.Account(item("verdict0021")), HistoryEntry.Account(item("case0000012")))
        assertEquals(en.appHistoryRemoveConfirm(2), HistoryLabels.removeConfirm(account, en))
        assertTrue(en.appHistoryRemoveConfirm(2).startsWith("Remove 2 verdicts from your account?"))
    }

    @Test
    fun showMore_loadsTheNextPage_andTheEndOfTheListAsksForItToo() {
        var loads = 0
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(entries, {}, { _, _ -> }, {}, paging = HistoryPaging(next = page.next, loadedAt = 1L), onLoadMore = { loads++ }, now = now)
            }
        }
        compose.waitForIdle()
        // The whole page fits on this screen, so its end is already in view.
        assertEquals(1, loads)
        compose.onNodeWithTag(HistoryTags.MORE).performScrollTo().performClick()
        assertEquals(2, loads)
    }

    @Test
    fun aFailedLoad_saysSo_aboveWhatThePhoneHas() {
        var retried = 0
        compose.setContent {
            Themed(AppLang.EN) {
                HistoryScreen(entries, {}, { _, _ -> }, {}, paging = HistoryPaging(failed = true), notice = HistoryNotice.Offline, onRetry = { retried++ }, now = now)
            }
        }
        compose.onNodeWithTag(HistoryTags.ERROR).assertExists()
        compose.onNodeWithText(en.appHistoryOfflineRemove).assertExists()
        compose.onNodeWithText(en.appRetry).performClick()
        assertEquals(1, retried)
    }

    @Test
    fun labels_followTheViewersParty_andReadAnOldInviteAsExpired() {
        val waiting = item("case0000010")
        assertEquals("Sam", HistoryLabels.otherName(waiting))
        assertEquals("Waiting for Sam to answer", HistoryLabels.status(waiting, en, now))
        assertEquals(en.historyStateExpired, HistoryLabels.status(waiting, en, Instant.parse("2026-10-28T00:00:00Z").toEpochMilli()))
        assertEquals(en.historyStateWaitingOther, HistoryLabels.status(waiting.copy(nameMap = emptyList()), en, now))

        val answered = item("case0000013")
        assertEquals("Alex", HistoryLabels.otherName(answered))
        assertEquals(HistoryLabels.Tone.YOURS, HistoryLabels.tone(answered, now))
        assertEquals("Alex is right", HistoryLabels.status(answered.copy(verdict = "side_a"), en, now))
        assertEquals(HistoryLabels.Tone.THEIRS, HistoryLabels.tone(answered.copy(verdict = "side_a"), now))

        val removed = item("verdict0021").copy(state = "removed", removed = true, headline = null, verdict = null)
        assertEquals(en.historyStateRemoved, HistoryLabels.title(removed, en, AppLang.EN))
        assertEquals("the title already says it", null, HistoryLabels.status(removed, en, now))
        assertEquals("a state this build doesn't know gets no label", null, HistoryLabels.status(waiting.copy(state = "archived"), en, now))
        assertEquals(en.historyStateReady, HistoryLabels.status(item("verdict0021").copy(verdict = null), en, now))
    }
}
