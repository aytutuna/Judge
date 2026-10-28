package com.okjudge.judge.ui

import com.okjudge.judge.Fixtures
import com.okjudge.judge.core.data.SavedVerdict
import com.okjudge.judge.core.model.CaseListResponse
import com.okjudge.judge.core.model.WireJson
import com.okjudge.judge.ui.history.HistorySelection
import com.okjudge.judge.ui.history.mergeHistory
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HistorySelectionTest {
    private val saved = listOf("win_a_self", "win_b_named").mapIndexed { i, n ->
        val o = sample(n)
        SavedVerdict(o.id, 1_760_900_000_000L - i, o.result, o.nameMap, emptyMap())
    }
    private val cases =
        WireJson.json.decodeFromString(CaseListResponse.serializer(), Fixtures.verdicts["cases"]!!.jsonObject["list"].toString()).cases
    private val selectable = HistorySelection.selectable(mergeHistory(saved, cases))

    @Test
    fun onlySavedVerdictsAreSelectable() {
        assertEquals(saved.map { it.id }.toSet(), selectable.toSet())
        assertEquals(2, selectable.size)
    }

    @Test
    fun toggle_addsThenRemoves() {
        val one = HistorySelection().toggle(saved[0].id)
        assertEquals(setOf(saved[0].id), one.ids)
        assertEquals(emptySet<String>(), one.toggle(saved[0].id).ids)
    }

    @Test
    fun toggleAll_selectsEveryVerdict_thenNone() {
        val all = HistorySelection().toggle(saved[0].id).toggleAll(selectable)
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
