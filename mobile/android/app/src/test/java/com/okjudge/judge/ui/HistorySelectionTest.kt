package com.okjudge.judge.ui

import com.okjudge.judge.ui.history.HistorySelection
import com.okjudge.judge.ui.history.mergeHistory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HistorySelectionTest {
    private val page = historyPage()
    private val phone = savedSample("win_a_self", 1_760_000_000_000L)
    private val entries = mergeHistory(page.items, listOf(phone), user = "u1")
    private val selectable = HistorySelection.selectable(entries)

    @Test
    fun removableAccountRowsAndPhoneRowsAreSelectable() {
        val removable = page.items.filter { it.removable }.map { it.key }
        assertEquals((removable + "v:${phone.id}").toSet(), selectable.toSet())
        // Judging, and removed by the other side: their own pages offer no Remove either.
        assertFalse("v:verdict0020" in selectable)
        assertFalse("c:case0000014" in selectable)
        assertTrue("the answered case can be removed from its side", "c:case0000013" in selectable)
    }

    @Test
    fun toggle_addsThenRemoves() {
        val one = HistorySelection().toggle(selectable[0])
        assertEquals(setOf(selectable[0]), one.ids)
        assertEquals(emptySet<String>(), one.toggle(selectable[0]).ids)
    }

    @Test
    fun toggleAll_selectsEveryRow_thenNone() {
        val all = HistorySelection().toggle(selectable[0]).toggleAll(selectable)
        assertEquals(selectable.toSet(), all.ids)
        assertTrue(all.allOf(selectable))
        val none = all.toggleAll(selectable)
        assertEquals(emptySet<String>(), none.ids)
        assertFalse(none.allOf(selectable))
    }

    @Test
    fun nothingSelectable_isNeverAllSelected() {
        assertFalse(HistorySelection().allOf(emptyList()))
        assertEquals(emptySet<String>(), HistorySelection().toggleAll(emptyList()).ids)
    }
}
