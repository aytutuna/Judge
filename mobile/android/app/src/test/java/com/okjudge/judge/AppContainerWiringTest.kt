package com.okjudge.judge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.core.auth.Routes
import com.okjudge.judge.core.auth.Routes.Companion.json
import kotlinx.coroutines.runBlocking
import mockwebserver3.MockWebServer
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class AppContainerWiringTest {
    private lateinit var server: MockWebServer
    private val routes = Routes()

    @Before
    fun setUp() {
        server = MockWebServer()
        server.dispatcher = routes
        server.start()
    }

    @After
    fun tearDown() = server.close()

    @Test
    fun theAccountLeaving_clearsTheParentRequest() = runBlocking {
        routes.always(
            "GET /api/v1/me/parent",
            json(200, """{"status":"pending","sent":true,"emailHint":"m***@example.com","expired":false,"resendsLeft":3,"changesLeft":3}"""),
        )
        val context: Context = ApplicationProvider.getApplicationContext()
        val container = AppContainer(
            context,
            AppConfig(server.url("/").toString(), "https://okjudge.com", "", versionName = "test", versionCode = 1),
        )
        container.start()
        container.parentConsent.load()
        assertNotNull(container.parentConsent.state.value.view)
        container.account.onLeaving()
        assertNull(container.parentConsent.state.value.view)
    }
}
