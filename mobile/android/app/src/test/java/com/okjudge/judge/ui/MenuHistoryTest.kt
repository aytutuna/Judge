package com.okjudge.judge.ui

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import com.okjudge.judge.core.model.LiveState
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.ui.history.HistoryEntry
import com.okjudge.judge.ui.history.HistoryLabels
import com.okjudge.judge.ui.history.HistoryNotice
import com.okjudge.judge.ui.history.HistoryPaging
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
class MenuHistoryTest {
    @get:Rule
    val compose = createComposeRule()

    private val en = UiTestSupport.s(AppLang.EN)
    private val page = historyPage()
    private val now = Instant.parse("2026-10-21T08:00:00Z").toEpochMilli()
    private val phone = savedSample("win_b_named", Instant.parse("2026-10-17T08:00:00Z").toEpochMilli())
    private val entries = mergeHistory(page.items, listOf(phone), user = "u1")

    private fun item(id: String) = page.items.first { it.id == id }

    private fun menu(
        list: List<HistoryEntry> = entries,
        onOpen: (HistoryEntry) -> Unit = {},
        onRemove: (HistoryEntry) -> Unit = {},
        paging: HistoryPaging = HistoryPaging(),
        notice: HistoryNotice? = null,
        onLoadMore: () -> Unit = {},
        onRetry: () -> Unit = {},
        live: Map<String, LiveState> = emptyMap(),
        account: AccountActions = AccountActions(false, null, {}, {}, {}),
    ) = compose.setContent {
        Themed(AppLang.EN) {
            MenuPanel(
                Tab.NEW, list, false, FocusRequester(), {}, onOpen, {},
                account = account, paging = paging, notice = notice, onRemove = onRemove, onLoadMore = onLoadMore, onRetry = onRetry, live = live, now = now,
            )
        }
    }

    @Test
    fun aWaitingLinkRow_saysTypingOrOpened_insteadOfWaiting() {
        val waiting = entries.first { it.waitingLinkId != null }
        val id = waiting.waitingLinkId!!
        menu(live = mapOf(id to LiveState.TYPING))
        compose.onNodeWithText(en.caseSideTyping).assertExists()
        compose.onNodeWithText("Waiting for Sam to answer").assertDoesNotExist()
    }

    @Test
    fun aWaitingLinkRow_withNoLiveState_keepsItsOwnWords() {
        val id = entries.first { it.waitingLinkId != null }.waitingLinkId!!
        menu(live = mapOf(id to LiveState.WAITING))
        compose.onNodeWithText("Waiting for Sam to answer").assertExists()
    }

    @Test
    fun eachCard_saysWhereItStands_fromTheViewersSide() {
        menu()
        compose.onNodeWithText("Waiting for Sam to answer").assertExists()
        compose.onNodeWithText(en.historyStateJudging).assertExists()
        compose.onNodeWithText(en.shellUntitled).assertExists()
        compose.onNodeWithText(en.historyStateExpired).assertExists()
        // The verdict the viewer wrote and the case they answered both went their way.
        compose.onAllNodesWithText(en.verdictWinSelf).assertCountEquals(2)
        compose.onNodeWithText(en.verdictWin("Sam")).assertExists()
        compose.onNodeWithText("Alex owes half the deposit").assertExists()
        compose.onNodeWithText(en.historyStateRemovedBy("Sam")).assertExists()
        compose.onNodeWithTag(PageBarTags.PHONE_NOTE).performScrollTo().assertExists()
        assertEquals(
            listOf("c:case0000010", "v:verdict0020", "c:case0000011", "v:verdict0021", "v:${phone.id}", "c:case0000012", "c:case0000013", "c:case0000014"),
            entries.map { it.key },
        )
    }

    @Test
    fun verdictsAndLinks_areTwoHeadedSections() {
        menu()
        compose.onNodeWithTag(PageBarTags.VERDICTS).assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
        compose.onNodeWithTag(PageBarTags.LINKS).assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
        val top = { tag: String -> compose.onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot.top }
        assertTrue(top(PageBarTags.VERDICTS) < top(PageBarTags.recent("v:verdict0020")))
        assertTrue(top(PageBarTags.recent("v:${phone.id}")) < top(PageBarTags.LINKS))
        assertTrue(top(PageBarTags.LINKS) < top(PageBarTags.recent("c:case0000010")))
    }

    @Test
    fun aMenuWithOnlyVerdicts_hasNoLinksHeading() {
        menu(phoneRows("win_a_self"))
        compose.onNodeWithTag(PageBarTags.VERDICTS).assertExists()
        compose.onNodeWithTag(PageBarTags.LINKS).assertDoesNotExist()
    }

    @Test
    fun cardsOpen_exceptOnesStillBeingJudged() {
        val opened = mutableListOf<String>()
        menu(onOpen = { opened += it.key })
        compose.onNodeWithTag(PageBarTags.recent("c:case0000013")).performClick()
        compose.onNodeWithTag(PageBarTags.recent("v:verdict0020")).performClick()
        compose.onNodeWithTag(PageBarTags.recent("c:case0000014")).performClick()
        compose.onNodeWithTag(PageBarTags.recent("v:${phone.id}")).performClick()
        assertEquals(listOf("c:case0000013", "c:case0000014", "v:${phone.id}"), opened)
    }

    @Test
    fun longPress_asksBeforeRemoving_inPlainWords() {
        val removed = mutableListOf<String>()
        menu(onRemove = { removed += it.key })
        compose.onNodeWithTag(PageBarTags.recent("v:verdict0021")).performTouchInput { longClick() }
        compose.onNodeWithText(
            "Remove this verdict from your account? What you wrote and the names are erased and its share link stops working, on every device. This can't be undone.",
            substring = true,
        ).assertExists()
        compose.onNodeWithText(en.appCancel).performClick()
        assertTrue(removed.isEmpty())

        compose.onNodeWithTag(PageBarTags.recent("v:verdict0021")).performTouchInput { longClick() }
        compose.onNodeWithTag(PageBarTags.CONFIRM_DELETE).performClick()
        assertEquals(listOf("v:verdict0021"), removed)

        compose.onNodeWithTag(PageBarTags.recent("v:${phone.id}")).performTouchInput { longClick() }
        compose.onNodeWithText("Delete this verdict from this phone? Its share link keeps working.").assertExists()
    }

    @Test
    fun aSwipeFromTheStartEdge_asksToRemoveToo_andOnesThatCannotBeRemovedDoNot() {
        val removed = mutableListOf<String>()
        menu(onRemove = { removed += it.key })
        compose.onNodeWithTag(PageBarTags.recent("v:verdict0021")).performTouchInput { swipeRight() }
        compose.waitForIdle()
        compose.onNodeWithTag(PageBarTags.CONFIRM_DELETE).performClick()
        assertEquals(listOf("v:verdict0021"), removed)

        // Still being judged: nothing to remove from here.
        compose.onNodeWithTag(PageBarTags.recent("v:verdict0020")).performTouchInput { longClick() }
        compose.onNodeWithTag(PageBarTags.CONFIRM_DELETE).assertDoesNotExist()
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
        menu(paging = HistoryPaging(next = page.next, loadedAt = 1L), onLoadMore = { loads++ })
        compose.waitForIdle()
        // The whole page fits on this screen, so its end is already in view.
        assertEquals(1, loads)
        compose.onNodeWithTag(PageBarTags.MORE).performScrollTo().performClick()
        assertEquals(2, loads)
    }

    @Test
    fun aFailedLoad_saysSo_aboveWhatThePhoneHas() {
        var retried = 0
        menu(paging = HistoryPaging(failed = true), notice = HistoryNotice.Offline, onRetry = { retried++ })
        compose.onNodeWithTag(PageBarTags.ERROR).assertExists()
        compose.onNodeWithText(en.appHistoryOfflineRemove).assertExists()
        compose.onNodeWithText(en.appRetry).performClick()
        assertEquals(1, retried)
    }

    @Test
    fun anEmptyList_signedOut_asksForSignIn_andSignedInDoesNot() {
        var signIn = 0
        menu(emptyList(), account = AccountActions(false, null, {}, { signIn++ }, {}))
        compose.onNodeWithTag(PageBarTags.EMPTY_SIGN_IN).assertTextEquals(en.shellLocalSignIn).performClick()
        assertEquals(1, signIn)
    }

    @Test
    fun anEmptyList_signedIn_hasNoSignInButton() {
        menu(emptyList(), account = AccountActions(true, null, {}, {}, {}))
        compose.onNodeWithTag(PageBarTags.EMPTY).assertExists()
        compose.onNodeWithTag(PageBarTags.EMPTY_SIGN_IN).assertDoesNotExist()
    }

    @Test
    fun withNothingToShow_theMenuSaysLoadingFailedOrEmpty() {
        menu(emptyList())
        compose.onNodeWithTag(PageBarTags.EMPTY).assertExists()
        compose.onNodeWithTag(PageBarTags.VERDICTS).assertDoesNotExist()
        compose.onNodeWithTag(PageBarTags.LINKS).assertDoesNotExist()
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

    @Test
    fun labels_forThreeSides_readTheWinnerAgainstTheViewersParty() {
        val base = item("case0000013").copy(parties = listOf("a", "b", "c"), verdict = "too_close", nameMap = emptyList())
        val won = base.copy(party = "c", winner = "c")
        assertEquals(HistoryLabels.Tone.YOURS, HistoryLabels.tone(won, now))
        assertEquals(en.verdictWinSelf, HistoryLabels.status(won, en, now))
        val lost = base.copy(party = "a", winner = "c")
        assertEquals(HistoryLabels.Tone.THEIRS, HistoryLabels.tone(lost, now))
        assertEquals(en.verdictWin(en.partyC), HistoryLabels.status(lost, en, now))
        val tie = base.copy(party = "b", winner = null)
        assertEquals(HistoryLabels.Tone.NEUTRAL, HistoryLabels.tone(tie, now))
        assertEquals(en.verdictTooClose, HistoryLabels.status(tie, en, now))
        assertEquals("nobody is the other side", null, HistoryLabels.otherName(won))
    }
}
