package com.okjudge.judge.core.session

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PrefsDraftTest {
    private var now = 10L * 24 * 60 * 60 * 1000
    private val prefs by lazy {
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("draft_test", Context.MODE_PRIVATE)
    }
    private val store by lazy { PrefsDraft(prefs) { now } }

    @Before
    fun clean() {
        prefs.edit().clear().commit()
    }

    @Test
    fun aDraftComesBackAsSaved() {
        val draft = Draft("mine", "theirs", "Sam", "Alex", true, listOf("third"), listOf("Kim"))
        store.save(draft)
        assertEquals(draft, store.load())
    }

    @Test
    fun anEmptyAddedSideIsKept() {
        val draft = Draft(argument = "mine", theirsOpen = true, moreText = listOf(""), moreName = listOf(""))
        store.save(draft)
        assertEquals(listOf(""), store.load()!!.moreText)
        assertEquals(listOf(""), store.load()!!.moreName)
    }

    @Test
    fun noAddedSidesStaysNone() {
        store.save(Draft(argument = "mine"))
        assertEquals(emptyList<String>(), store.load()!!.moreText)
    }

    @Test
    fun aDraftOlderThanADayIsGone() {
        store.save(Draft(argument = "mine"))
        now += 24L * 60 * 60 * 1000 - 1
        assertEquals("mine", store.load()!!.argument)
        now += 2
        assertNull(store.load())
        assertNull(PrefsDraft(prefs) { now }.load())
    }

    @Test
    fun aDraftWithoutATimeIsGone() {
        prefs.edit().putString("argument", "old").commit()
        assertNull(store.load())
    }
}
