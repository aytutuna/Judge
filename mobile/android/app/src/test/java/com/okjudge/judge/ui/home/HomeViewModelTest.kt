package com.okjudge.judge.ui.home

import androidx.lifecycle.SavedStateHandle
import com.okjudge.judge.FakeHistory
import com.okjudge.judge.core.api.JudgeApi
import com.okjudge.judge.core.api.NoBotCheck
import com.okjudge.judge.core.data.SettingsStore
import com.okjudge.judge.core.display.Examples
import com.okjudge.judge.core.display.Preset
import com.okjudge.judge.core.premium.Tier
import com.okjudge.judge.core.session.VerdictFlow
import com.okjudge.judge.i18n.AppLang
import com.okjudge.judge.i18n.LangPref
import com.okjudge.judge.ui.UiTestSupport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.random.Random

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class HomeViewModelTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined)

    private class FakeSettings : SettingsStore {
        override val langPref = MutableStateFlow(LangPref.SYSTEM)
        override val lastPreset = MutableStateFlow(Preset.DEFAULT)
        override val tierChoice = MutableStateFlow(Tier.FREE)
        override suspend fun setLangPref(pref: LangPref) { langPref.value = pref }
        override suspend fun setLastPreset(preset: Preset) { lastPreset.value = preset }
        override suspend fun setTierChoice(tier: Tier) { tierChoice.value = tier }
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
    }

    @After
    fun tearDown() {
        scope.cancel()
        Dispatchers.resetMain()
    }

    private fun vm(random: Random = Random(7)): HomeViewModel {
        val api = JudgeApi("http://localhost:1/", OkHttpClient(), "ua")
        return HomeViewModel(SavedStateHandle(), FakeSettings(), VerdictFlow(api, NoBotCheck, FakeHistory(), scope), random = random)
    }

    @Test
    fun everyExample_hasBothNamesAndBothSides_inBothLanguages() {
        for (lang in AppLang.entries) {
            val s = UiTestSupport.s(lang)
            for (id in Examples.ids) {
                val e = Examples.of(id, s)
                assertTrue("$lang $id", listOf(e.myName, e.mine, e.theirName, e.theirs).all { it.isNotBlank() })
            }
        }
    }

    @Test
    fun example_replacesWhatWasTyped_andNeverRepeatsTwiceInARow() {
        val en = UiTestSupport.s(AppLang.EN)
        val vm = vm()
        vm.onArgumentChange("something I typed myself")
        vm.onOtherName("Jo")
        var last = vm.state.value
        repeat(30) {
            vm.fillExample(en)
            val now = vm.state.value
            val example = Examples.ids.map { Examples.of(it, en) }.single { it.mine == now.argument }
            assertEquals(example.myName, now.shownName)
            assertEquals(example.theirName, now.otherName)
            assertEquals(example.theirs, now.otherSide)
            assertNotEquals("not the same one again", last.argument, now.argument)
            last = now
        }
    }

    @Test
    fun example_isInTheAppLanguage() {
        val tr = UiTestSupport.s(AppLang.TR)
        val vm = vm()
        vm.fillExample(tr)
        assertTrue(Examples.ids.any { Examples.of(it, tr).mine == vm.state.value.argument })
    }

    @Test
    fun clear_dropsTheExampleName_butKeepsOneTheUserTyped() {
        val en = UiTestSupport.s(AppLang.EN)
        val vm = vm()
        vm.fillExample(en)
        vm.clear()
        assertTrue(vm.state.value.blank)
        assertEquals("", vm.state.value.shownName)
        assertEquals("", vm.state.value.otherName)

        vm.onDisplayName("Ada")
        vm.fillExample(en)
        vm.onDisplayName("Ada")
        vm.clear()
        assertEquals("Ada", vm.state.value.shownName)
        assertTrue(vm.state.value.blank)
    }
}
