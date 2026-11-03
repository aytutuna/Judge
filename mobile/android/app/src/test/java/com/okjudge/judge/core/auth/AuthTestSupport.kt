package com.okjudge.judge.core.auth

import mockwebserver3.Dispatcher
import mockwebserver3.MockResponse
import mockwebserver3.RecordedRequest
import mockwebserver3.SocketEffect
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Answers by "METHOD /path" so background calls (the /me refresh after a
 * sign-in) cannot steal another call's response. Unrouted calls get a 404.
 */
class Routes : Dispatcher() {
    private val routes = ConcurrentHashMap<String, ConcurrentLinkedQueue<MockResponse>>()
    private val sticky = ConcurrentHashMap<String, MockResponse>()
    val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())

    /** Queues one response for [route] ("POST /api/auth/sign-out"). */
    fun on(route: String, response: MockResponse): Routes {
        routes.getOrPut(route) { ConcurrentLinkedQueue() }.add(response)
        return this
    }

    /** Answers [route] with [response] every time once its queue is empty. */
    fun always(route: String, response: MockResponse): Routes {
        sticky[route] = response
        return this
    }

    fun requestsTo(route: String): List<RecordedRequest> =
        synchronized(requests) { requests.filter { "${it.method} ${it.url.encodedPath}" == route } }

    override fun dispatch(request: RecordedRequest): MockResponse {
        requests += request
        val route = "${request.method} ${request.url.encodedPath}"
        return routes[route]?.poll() ?: sticky[route] ?: json(404, """{"message":"Not found","code":"NOT_FOUND"}""")
    }

    companion object {
        fun json(code: Int, body: String): MockResponse =
            MockResponse.Builder().code(code).addHeader("Content-Type", "application/json").body(body).build()

        fun dropped(): MockResponse = MockResponse.Builder().onRequestStart(SocketEffect.ShutdownConnection).build()

        const val CONFIG = "GET /api/v1/config"
        const val ME = "GET /api/v1/me"
        const val DELETE_ME = "DELETE /api/v1/me"
        const val GOOGLE = "POST /api/auth/sign-in/social"
        const val SEND_CODE = "POST /api/auth/email-otp/send-verification-otp"
        const val VERIFY_CODE = "POST /api/auth/sign-in/email-otp"
        const val SIGN_OUT = "POST /api/auth/sign-out"

        fun config(google: Boolean, emailCode: Boolean, apple: Boolean = false) = json(
            200,
            """{"signIn":{"apple":$apple,"google":$google,"email":$emailCode,"emailCode":$emailCode,"dev":false},
               "premiumEnabled":false,"pricing":{"currency":"USD","purchasesEnabled":false,"packs":[],
               "monthly":{"id":"monthly","priceUsd":4.99,"fairUseCap":100,"periodDays":30}},
               "features":{"cases":false,"evidence":false}}""",
        )

        fun grant(token: String, email: String = "ada@example.com") = json(
            200,
            """{"redirect":false,"token":"$token","user":{"id":"u1","email":"$email","name":"Ada","emailVerified":true}}""",
        )

        fun me(email: String = "ada@example.com", credits: Int = 0) = json(
            200,
            """{"user":{"id":"u1","email":"$email","name":"Ada","image":null},
               "entitlement":{"canUsePremium":${credits > 0},"blockedReason":${if (credits > 0) "null" else "\"premium_required\""},
               "credits":$credits,"subscription":null,"resetsAt":null}}""",
        )

        val signedOutMe = json(200, """{"user":null,"entitlement":null}""")
    }
}

/** Reversible stand-in for the Keystore cipher (Robolectric has no AndroidKeyStore). */
class FakeCipher(private val failEncrypt: Boolean = false) : TokenCipher {
    override fun encrypt(plain: String): String {
        if (failEncrypt) throw IllegalStateException("no key")
        return "sealed:" + plain.reversed()
    }

    override fun decrypt(sealed: String): String {
        require(sealed.startsWith("sealed:")) { "not sealed" }
        return sealed.removePrefix("sealed:").reversed()
    }
}

/** A Google picker that answers with [result] and counts its calls. */
class FakeGoogle(var result: GoogleIdResult) : GoogleIdTokenSource {
    var calls = 0
    override suspend fun idToken(host: android.content.Context): GoogleIdResult {
        calls++
        return result
    }
}
